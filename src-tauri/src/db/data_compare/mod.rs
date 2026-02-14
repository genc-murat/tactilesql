// =====================================================
// DATA COMPARE MODULE
// Table data comparison and sync script generation
// =====================================================

use crate::db_types::{ColumnSchema, DatabaseType, PrimaryKey, QueryResult};
use crate::mysql;
use crate::postgres;
use crate::clickhouse;
use crate::mssql;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

use super::sql_utils::{qualified_table_name, quote_column_name, value_to_sql_literal};
use super::AppState;
use tauri::State;

// =====================================================
// TYPES AND STRUCTS
// =====================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCompareRequest {
    pub source_database: String,
    pub source_table: String,
    pub target_database: String,
    pub target_table: String,
    pub key_columns: Option<Vec<String>>,
    pub compare_columns: Option<Vec<String>>,
    pub sample_limit: Option<usize>,
    pub max_rows: Option<usize>,
    pub include_inserts: Option<bool>,
    pub include_updates: Option<bool>,
    pub include_deletes: Option<bool>,
    pub wrap_in_transaction: Option<bool>,
    pub statement_limit: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCompareSummary {
    pub source_rows: usize,
    pub target_rows: usize,
    pub missing_in_target: usize,
    pub extra_in_target: usize,
    pub changed: usize,
    pub unchanged: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRowDiffSample {
    pub diff_type: String,
    pub key: serde_json::Map<String, serde_json::Value>,
    pub source_row: Option<serde_json::Map<String, serde_json::Value>>,
    pub target_row: Option<serde_json::Map<String, serde_json::Value>>,
    pub changed_columns: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCompareResult {
    pub source_database: String,
    pub source_table: String,
    pub target_database: String,
    pub target_table: String,
    pub key_columns: Vec<String>,
    pub compare_columns: Vec<String>,
    pub summary: DataCompareSummary,
    pub samples: Vec<DataRowDiffSample>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSyncStatementCounts {
    pub inserts: usize,
    pub updates: usize,
    pub deletes: usize,
    pub total: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSyncPlan {
    pub script: String,
    pub key_columns: Vec<String>,
    pub compare_columns: Vec<String>,
    pub summary: DataCompareSummary,
    pub statement_counts: DataSyncStatementCounts,
    pub warnings: Vec<String>,
    pub truncated: bool,
}

// =====================================================
// CONSTANTS
// =====================================================

pub const DATA_COMPARE_DEFAULT_MAX_ROWS: usize = 20_000;
pub const DATA_COMPARE_MAX_MAX_ROWS: usize = 500_000;
pub const DATA_COMPARE_DEFAULT_SAMPLE_LIMIT: usize = 50;
pub const DATA_COMPARE_MAX_SAMPLE_LIMIT: usize = 500;
pub const DATA_COMPARE_DEFAULT_STATEMENT_LIMIT: usize = 10_000;
pub const DATA_COMPARE_MAX_STATEMENT_LIMIT: usize = 200_000;

pub type DataRowMap = BTreeMap<String, serde_json::Value>;

#[derive(Clone)]
pub struct DataChangedRowInternal {
    pub source_row: DataRowMap,
    pub target_row: DataRowMap,
    pub changed_canonicals: Vec<String>,
}

pub struct DataCompareInternalResult {
    pub db_type: DatabaseType,
    pub source_database: String,
    pub source_table: String,
    pub target_database: String,
    pub target_table: String,
    pub key_canonicals: Vec<String>,
    pub compare_canonicals: Vec<String>,
    pub insert_canonicals: Vec<String>,
    pub output_name_by_canonical: HashMap<String, String>,
    pub target_name_by_canonical: HashMap<String, String>,
    pub summary: DataCompareSummary,
    pub missing_rows: Vec<DataRowMap>,
    pub extra_rows: Vec<DataRowMap>,
    pub changed_rows: Vec<DataChangedRowInternal>,
    pub warnings: Vec<String>,
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

pub fn normalize_identifier_token(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub fn parse_non_empty_field(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{} is required", label));
    }
    Ok(trimmed.to_string())
}

pub fn normalize_identifier_list(values: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for value in values {
        let token = normalize_identifier_token(value);
        if token.is_empty() || seen.contains(&token) {
            continue;
        }
        seen.insert(token.clone());
        normalized.push(token);
    }
    normalized
}

pub fn clamp_data_compare_max_rows(value: Option<usize>) -> usize {
    value
        .unwrap_or(DATA_COMPARE_DEFAULT_MAX_ROWS)
        .clamp(1, DATA_COMPARE_MAX_MAX_ROWS)
}

pub fn clamp_data_compare_sample_limit(value: Option<usize>) -> usize {
    value
        .unwrap_or(DATA_COMPARE_DEFAULT_SAMPLE_LIMIT)
        .clamp(1, DATA_COMPARE_MAX_SAMPLE_LIMIT)
}

pub fn clamp_data_compare_statement_limit(value: Option<usize>) -> usize {
    value
        .unwrap_or(DATA_COMPARE_DEFAULT_STATEMENT_LIMIT)
        .clamp(1, DATA_COMPARE_MAX_STATEMENT_LIMIT)
}

pub fn canonical_list_to_display(
    canonicals: &[String],
    output_name_by_canonical: &HashMap<String, String>,
) -> Vec<String> {
    canonicals
        .iter()
        .map(|canonical| {
            output_name_by_canonical
                .get(canonical)
                .cloned()
                .unwrap_or_else(|| canonical.clone())
        })
        .collect()
}

pub fn combine_canonicals(primary: &[String], secondary: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut combined = Vec::new();

    for item in primary {
        if seen.insert(item.clone()) {
            combined.push(item.clone());
        }
    }
    for item in secondary {
        if seen.insert(item.clone()) {
            combined.push(item.clone());
        }
    }

    combined
}

pub fn map_common_columns(
    source_schema: &[ColumnSchema],
    target_schema: &[ColumnSchema],
) -> (
    Vec<String>,
    HashMap<String, String>,
    HashMap<String, String>,
    HashMap<String, String>,
) {
    let mut target_lookup: HashMap<String, String> = HashMap::new();
    for column in target_schema {
        let canonical = normalize_identifier_token(&column.name);
        if canonical.is_empty() || target_lookup.contains_key(&canonical) {
            continue;
        }
        target_lookup.insert(canonical, column.name.clone());
    }

    let mut common_canonicals = Vec::new();
    let mut source_name_by_canonical = HashMap::new();
    let mut target_name_by_canonical = HashMap::new();
    let mut output_name_by_canonical = HashMap::new();

    for column in source_schema {
        let canonical = normalize_identifier_token(&column.name);
        if canonical.is_empty() || source_name_by_canonical.contains_key(&canonical) {
            continue;
        }
        if let Some(target_name) = target_lookup.get(&canonical) {
            common_canonicals.push(canonical.clone());
            source_name_by_canonical.insert(canonical.clone(), column.name.clone());
            target_name_by_canonical.insert(canonical.clone(), target_name.clone());
            output_name_by_canonical.insert(canonical.clone(), column.name.clone());
        }
    }

    (
        common_canonicals,
        source_name_by_canonical,
        target_name_by_canonical,
        output_name_by_canonical,
    )
}

pub fn resolve_key_canonicals(
    request: &DataCompareRequest,
    common_canonicals: &[String],
    source_pk_columns: &[PrimaryKey],
    target_pk_columns: &[PrimaryKey],
) -> Result<Vec<String>, String> {
    let common_set = common_canonicals
        .iter()
        .cloned()
        .collect::<HashSet<String>>();

    let explicit_keys = request
        .key_columns
        .as_ref()
        .map(|items| normalize_identifier_list(items))
        .unwrap_or_default();

    let resolved = if explicit_keys.is_empty() {
        let source_pk = normalize_identifier_list(
            &source_pk_columns
                .iter()
                .map(|pk| pk.column_name.clone())
                .collect::<Vec<String>>(),
        );
        let target_pk_set = normalize_identifier_list(
            &target_pk_columns
                .iter()
                .map(|pk| pk.column_name.clone())
                .collect::<Vec<String>>(),
        )
        .into_iter()
        .collect::<HashSet<String>>();

        source_pk
            .into_iter()
            .filter(|column| common_set.contains(column) && target_pk_set.contains(column))
            .collect::<Vec<String>>()
    } else {
        explicit_keys
    };

    if resolved.is_empty() {
        return Err(
            "No shared primary key columns found. Provide keyColumns explicitly for comparison."
                .to_string(),
        );
    }

    for column in &resolved {
        if !common_set.contains(column) {
            return Err(format!(
                "Key column '{}' does not exist in both source and target tables",
                column
            ));
        }
    }

    Ok(resolved)
}

pub fn resolve_compare_canonicals(
    request: &DataCompareRequest,
    common_canonicals: &[String],
    key_canonicals: &[String],
) -> Result<Vec<String>, String> {
    let common_set = common_canonicals
        .iter()
        .cloned()
        .collect::<HashSet<String>>();
    let key_set = key_canonicals.iter().cloned().collect::<HashSet<String>>();

    let requested = request
        .compare_columns
        .as_ref()
        .map(|items| normalize_identifier_list(items));

    let resolved = if let Some(requested_columns) = requested {
        requested_columns
    } else {
        common_canonicals
            .iter()
            .filter(|column| !key_set.contains(*column))
            .cloned()
            .collect::<Vec<String>>()
    };

    for column in &resolved {
        if !common_set.contains(column) {
            return Err(format!(
                "Compare column '{}' does not exist in both source and target tables",
                column
            ));
        }
        if key_set.contains(column) {
            return Err(format!(
                "Compare column '{}' is also included in keyColumns. Remove it from compareColumns.",
                column
            ));
        }
    }

    Ok(resolved)
}

pub fn parse_count_value(value: &serde_json::Value) -> Option<usize> {
    match value {
        serde_json::Value::Number(number) => {
            if let Some(unsigned) = number.as_u64() {
                usize::try_from(unsigned).ok()
            } else if let Some(signed) = number.as_i64() {
                if signed < 0 {
                    None
                } else {
                    usize::try_from(signed as u64).ok()
                }
            } else {
                None
            }
        }
        serde_json::Value::String(text) => text.trim().parse::<usize>().ok(),
        serde_json::Value::Bool(flag) => {
            if *flag {
                Some(1)
            } else {
                Some(0)
            }
        }
        _ => None,
    }
}

pub fn parse_count_from_results(results: Vec<QueryResult>, label: &str) -> Result<usize, String> {
    let first_result = results
        .into_iter()
        .next()
        .ok_or_else(|| format!("COUNT(*) query returned no result for {}", label))?;
    let first_row = first_result
        .rows
        .first()
        .ok_or_else(|| format!("COUNT(*) query returned no row for {}", label))?;
    let first_value = first_row
        .first()
        .ok_or_else(|| format!("COUNT(*) query returned no value for {}", label))?;

    parse_count_value(first_value).ok_or_else(|| {
        format!(
            "Failed to parse COUNT(*) value for {}. Received: {}",
            label, first_value
        )
    })
}

pub fn query_result_to_row_maps(
    result: QueryResult,
    canonicals: &[String],
    label: &str,
) -> Result<Vec<DataRowMap>, String> {
    if canonicals.is_empty() {
        return Ok(Vec::new());
    }

    let mut rows = Vec::with_capacity(result.rows.len());
    for (row_idx, row_values) in result.rows.into_iter().enumerate() {
        if row_values.len() < canonicals.len() {
            return Err(format!(
                "Unexpected row shape for {} at row {}: expected at least {} columns, got {}",
                label,
                row_idx + 1,
                canonicals.len(),
                row_values.len()
            ));
        }

        let mut row_map = DataRowMap::new();
        for (idx, canonical) in canonicals.iter().enumerate() {
            row_map.insert(
                canonical.clone(),
                row_values
                    .get(idx)
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            );
        }
        rows.push(row_map);
    }

    Ok(rows)
}

pub fn build_row_key_token(row: &DataRowMap, key_canonicals: &[String]) -> Result<String, String> {
    let values = key_canonicals
        .iter()
        .map(|column| row.get(column).cloned().unwrap_or(serde_json::Value::Null))
        .collect::<Vec<serde_json::Value>>();
    serde_json::to_string(&values).map_err(|e| format!("Failed to serialize key token: {}", e))
}

pub fn build_key_index(
    rows: Vec<DataRowMap>,
    key_canonicals: &[String],
    side_label: &str,
) -> Result<BTreeMap<String, DataRowMap>, String> {
    let mut indexed = BTreeMap::new();
    let mut duplicate_keys = Vec::new();

    for row in rows {
        let key_token = build_row_key_token(&row, key_canonicals)?;
        if indexed.contains_key(&key_token) {
            duplicate_keys.push(key_token);
            if duplicate_keys.len() >= 5 {
                break;
            }
            continue;
        }
        indexed.insert(key_token, row);
    }

    if !duplicate_keys.is_empty() {
        return Err(format!(
            "Duplicate key values detected in {} table for selected keyColumns. Sample keys: {}",
            side_label,
            duplicate_keys.join(", ")
        ));
    }

    Ok(indexed)
}

pub fn find_changed_canonicals(
    source_row: &DataRowMap,
    target_row: &DataRowMap,
    compare_canonicals: &[String],
) -> Vec<String> {
    compare_canonicals
        .iter()
        .filter(|column| {
            let source_value = source_row
                .get(*column)
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let target_value = target_row
                .get(*column)
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            source_value != target_value
        })
        .cloned()
        .collect()
}

pub fn row_to_public_map(
    row: &DataRowMap,
    canonicals: &[String],
    output_name_by_canonical: &HashMap<String, String>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut public_row = serde_json::Map::new();
    for canonical in canonicals {
        let key = output_name_by_canonical
            .get(canonical)
            .cloned()
            .unwrap_or_else(|| canonical.clone());
        let value = row
            .get(canonical)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        public_row.insert(key, value);
    }
    public_row
}

pub fn column_has_auto_generated_default(column: &ColumnSchema) -> bool {
    let extra = column.extra.to_ascii_lowercase();
    if extra.contains("auto_increment") || extra.contains("generated") || extra.contains("identity")
    {
        return true;
    }
    if let Some(default_value) = &column.column_default {
        let normalized = default_value.to_ascii_lowercase();
        if normalized.contains("nextval(") {
            return true;
        }
    }
    false
}

// =====================================================
// STATEMENT BUILDERS
// =====================================================

pub fn build_insert_statement_for_row(
    db_type: &DatabaseType,
    qualified_target_table: &str,
    row: &DataRowMap,
    insert_canonicals: &[String],
    target_name_by_canonical: &HashMap<String, String>,
) -> Result<String, String> {
    let mut quoted_columns = Vec::new();
    let mut values = Vec::new();

    for canonical in insert_canonicals {
        let target_name = target_name_by_canonical
            .get(canonical)
            .ok_or_else(|| format!("Missing target column mapping for '{}'", canonical))?;
        quoted_columns.push(quote_column_name(db_type, target_name));
        values.push(value_to_sql_literal(
            &row.get(canonical)
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        ));
    }

    Ok(format!(
        "INSERT INTO {} ({}) VALUES ({});",
        qualified_target_table,
        quoted_columns.join(", "),
        values.join(", ")
    ))
}

pub fn build_where_clause_for_row(
    db_type: &DatabaseType,
    row: &DataRowMap,
    key_canonicals: &[String],
    target_name_by_canonical: &HashMap<String, String>,
) -> Result<String, String> {
    if key_canonicals.is_empty() {
        return Err("Cannot build WHERE clause without key columns".to_string());
    }

    let mut predicates = Vec::new();
    for canonical in key_canonicals {
        let target_name = target_name_by_canonical
            .get(canonical)
            .ok_or_else(|| format!("Missing target key column mapping for '{}'", canonical))?;
        let quoted = quote_column_name(db_type, target_name);
        let value = row
            .get(canonical)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        if value == serde_json::Value::Null {
            predicates.push(format!("{} IS NULL", quoted));
        } else {
            predicates.push(format!("{} = {}", quoted, value_to_sql_literal(&value)));
        }
    }

    Ok(predicates.join(" AND "))
}

pub fn build_update_statement_for_row(
    db_type: &DatabaseType,
    qualified_target_table: &str,
    source_row: &DataRowMap,
    changed_canonicals: &[String],
    key_canonicals: &[String],
    target_name_by_canonical: &HashMap<String, String>,
) -> Result<Option<String>, String> {
    if changed_canonicals.is_empty() {
        return Ok(None);
    }

    let mut assignments = Vec::new();
    for canonical in changed_canonicals {
        let target_name = target_name_by_canonical
            .get(canonical)
            .ok_or_else(|| format!("Missing target column mapping for '{}'", canonical))?;
        let quoted = quote_column_name(db_type, target_name);
        let value = source_row
            .get(canonical)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        assignments.push(format!("{} = {}", quoted, value_to_sql_literal(&value)));
    }

    let where_clause = build_where_clause_for_row(
        db_type,
        source_row,
        key_canonicals,
        target_name_by_canonical,
    )?;

    Ok(Some(format!(
        "UPDATE {} SET {} WHERE {};",
        qualified_target_table,
        assignments.join(", "),
        where_clause
    )))
}

pub fn build_delete_statement_for_row(
    db_type: &DatabaseType,
    qualified_target_table: &str,
    target_row: &DataRowMap,
    key_canonicals: &[String],
    target_name_by_canonical: &HashMap<String, String>,
) -> Result<String, String> {
    let where_clause = build_where_clause_for_row(
        db_type,
        target_row,
        key_canonicals,
        target_name_by_canonical,
    )?;

    Ok(format!(
        "DELETE FROM {} WHERE {};",
        qualified_target_table, where_clause
    ))
}

// ================= ====================================
// DATABASE LOADING FUNCTIONS
// =====================================================

pub async fn load_table_schema_for_compare(
    app_state: &AppState,
    db_type: &DatabaseType,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnSchema>, String> {
    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_schema(pool, database, table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_schema(pool, database, table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_schema(pool, database, "dbo", table).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard
                .as_ref()
                .ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_schema(config, database, table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

pub async fn load_table_primary_keys_for_compare(
    app_state: &AppState,
    db_type: &DatabaseType,
    database: &str,
    table: &str,
) -> Result<Vec<PrimaryKey>, String> {
    match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::get_table_primary_keys(pool, database, table).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::get_table_primary_keys(pool, database, table).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::get_table_primary_keys(pool, database, "dbo", table).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard
                .as_ref()
                .ok_or("No ClickHouse connection established")?;
            clickhouse::get_table_primary_keys(config, database, table).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }
}

pub async fn load_table_row_count_for_compare(
    app_state: &AppState,
    db_type: &DatabaseType,
    database: &str,
    table: &str,
    label: &str,
) -> Result<usize, String> {
    let query = format!(
        "SELECT COUNT(*) AS row_count FROM {}",
        qualified_table_name(db_type, database, table)
    );

    let results = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::execute_query(pool, query).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::execute_query(pool, query).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::execute_query(pool, query).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard
                .as_ref()
                .ok_or("No ClickHouse connection established")?;
            clickhouse::execute_query(config, query).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }?;

    parse_count_from_results(results, label)
}

pub async fn load_table_rows_for_compare(
    app_state: &AppState,
    db_type: &DatabaseType,
    database: &str,
    table: &str,
    actual_column_names: &[String],
    canonicals: &[String],
    label: &str,
) -> Result<Vec<DataRowMap>, String> {
    if canonicals.is_empty() || actual_column_names.is_empty() {
        return Ok(Vec::new());
    }
    if actual_column_names.len() != canonicals.len() {
        return Err(format!(
            "Column mapping mismatch for {}: {} canonical names vs {} actual column names",
            label,
            canonicals.len(),
            actual_column_names.len()
        ));
    }

    let select_columns = actual_column_names
        .iter()
        .map(|column| quote_column_name(db_type, column))
        .collect::<Vec<String>>()
        .join(", ");
    let query = format!(
        "SELECT {} FROM {}",
        select_columns,
        qualified_table_name(db_type, database, table)
    );

    let results = match db_type {
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard
                .as_ref()
                .ok_or("No PostgreSQL connection established")?;
            postgres::execute_query(pool, query).await
        }
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            mysql::execute_query(pool, query).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            mssql::execute_query(pool, query).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard
                .as_ref()
                .ok_or("No ClickHouse connection established")?;
            clickhouse::execute_query(config, query).await
        }
        DatabaseType::Disconnected => Err("No connection established".into()),
    }?;

    let first_result = results.into_iter().next().unwrap_or(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
    });
    query_result_to_row_maps(first_result, canonicals, label)
}

// =====================================================
// MAIN COMPARISON FUNCTIONS
// =====================================================

pub async fn compute_data_compare_internal(
    app_state: &AppState,
    request: &DataCompareRequest,
) -> Result<DataCompareInternalResult, String> {
    let source_database = parse_non_empty_field("sourceDatabase", &request.source_database)?;
    let source_table = parse_non_empty_field("sourceTable", &request.source_table)?;
    let target_database = parse_non_empty_field("targetDatabase", &request.target_database)?;
    let target_table = parse_non_empty_field("targetTable", &request.target_table)?;

    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };
    if db_type == DatabaseType::Disconnected {
        return Err("No connection established".to_string());
    }

    let source_schema =
        load_table_schema_for_compare(app_state, &db_type, &source_database, &source_table).await?;
    let target_schema =
        load_table_schema_for_compare(app_state, &db_type, &target_database, &target_table).await?;

    let (
        common_canonicals,
        source_name_by_canonical,
        target_name_by_canonical,
        output_name_by_canonical,
    ) = map_common_columns(&source_schema, &target_schema);

    if common_canonicals.is_empty() {
        return Err(
            "Source and target tables do not share any column names. Cannot compare data."
                .to_string(),
        );
    }

    let source_pk_columns =
        load_table_primary_keys_for_compare(app_state, &db_type, &source_database, &source_table)
            .await?;
    let target_pk_columns =
        load_table_primary_keys_for_compare(app_state, &db_type, &target_database, &target_table)
            .await?;

    let key_canonicals = resolve_key_canonicals(
        request,
        &common_canonicals,
        &source_pk_columns,
        &target_pk_columns,
    )?;
    let compare_canonicals =
        resolve_compare_canonicals(request, &common_canonicals, &key_canonicals)?;
    let insert_canonicals = common_canonicals.clone();

    let max_rows = clamp_data_compare_max_rows(request.max_rows);
    let source_row_count = load_table_row_count_for_compare(
        app_state,
        &db_type,
        &source_database,
        &source_table,
        "source",
    )
    .await?;
    let target_row_count = load_table_row_count_for_compare(
        app_state,
        &db_type,
        &target_database,
        &target_table,
        "target",
    )
    .await?;

    if source_row_count > max_rows || target_row_count > max_rows {
        return Err(format!(
            "Row guard triggered. source rows={}, target rows={}, maxRows={}. Reduce table size or increase maxRows.",
            source_row_count, target_row_count, max_rows
        ));
    }

    let source_actual_insert_columns = insert_canonicals
        .iter()
        .map(|canonical| {
            source_name_by_canonical
                .get(canonical)
                .cloned()
                .ok_or_else(|| format!("Missing source column mapping for '{}'", canonical))
        })
        .collect::<Result<Vec<String>, String>>()?;
    let target_select_canonicals = combine_canonicals(&key_canonicals, &compare_canonicals);
    let target_actual_compare_columns = target_select_canonicals
        .iter()
        .map(|canonical| {
            target_name_by_canonical
                .get(canonical)
                .cloned()
                .ok_or_else(|| format!("Missing target column mapping for '{}'", canonical))
        })
        .collect::<Result<Vec<String>, String>>()?;

    let source_rows = load_table_rows_for_compare(
        app_state,
        &db_type,
        &source_database,
        &source_table,
        &source_actual_insert_columns,
        &insert_canonicals,
        "source",
    )
    .await?;
    let target_rows = load_table_rows_for_compare(
        app_state,
        &db_type,
        &target_database,
        &target_table,
        &target_actual_compare_columns,
        &target_select_canonicals,
        "target",
    )
    .await?;

    let source_index = build_key_index(source_rows, &key_canonicals, "source")?;
    let target_index = build_key_index(target_rows, &key_canonicals, "target")?;

    let mut missing_rows = Vec::new();
    let mut extra_rows = Vec::new();
    let mut changed_rows = Vec::new();
    let mut unchanged = 0usize;

    for (key_token, source_row) in &source_index {
        if let Some(target_row) = target_index.get(key_token) {
            let changed_canonicals =
                find_changed_canonicals(source_row, target_row, &compare_canonicals);
            if changed_canonicals.is_empty() {
                unchanged += 1;
            } else {
                changed_rows.push(DataChangedRowInternal {
                    source_row: source_row.clone(),
                    target_row: target_row.clone(),
                    changed_canonicals,
                });
            }
        } else {
            missing_rows.push(source_row.clone());
        }
    }

    for (key_token, target_row) in &target_index {
        if !source_index.contains_key(key_token) {
            extra_rows.push(target_row.clone());
        }
    }

    let mut warnings = Vec::new();
    if compare_canonicals.is_empty() {
        warnings.push(
            "compareColumns is empty. Only missing/extra row detection is performed.".to_string(),
        );
    }

    let source_common_set = common_canonicals
        .iter()
        .cloned()
        .collect::<HashSet<String>>();
    let mut required_target_only_columns = Vec::new();
    for target_column in &target_schema {
        let canonical = normalize_identifier_token(&target_column.name);
        if canonical.is_empty() || source_common_set.contains(&canonical) {
            continue;
        }
        if !target_column.is_nullable
            && target_column.column_default.is_none()
            && !column_has_auto_generated_default(target_column)
        {
            required_target_only_columns.push(target_column.name.clone());
        }
    }
    if !required_target_only_columns.is_empty() {
        warnings.push(format!(
            "Target table has required columns missing in source: {}. INSERT sync statements may fail.",
            required_target_only_columns.join(", ")
        ));
    }

    Ok(DataCompareInternalResult {
        db_type,
        source_database,
        source_table,
        target_database,
        target_table,
        key_canonicals,
        compare_canonicals,
        insert_canonicals,
        output_name_by_canonical,
        target_name_by_canonical,
        summary: DataCompareSummary {
            source_rows: source_index.len(),
            target_rows: target_index.len(),
            missing_in_target: missing_rows.len(),
            extra_in_target: extra_rows.len(),
            changed: changed_rows.len(),
            unchanged,
        },
        missing_rows,
        extra_rows,
        changed_rows,
        warnings,
    })
}

pub fn build_data_compare_samples(
    internal: &DataCompareInternalResult,
    sample_limit: usize,
) -> Vec<DataRowDiffSample> {
    let mut samples = Vec::new();
    let row_fields = combine_canonicals(&internal.key_canonicals, &internal.compare_canonicals);

    for row in &internal.missing_rows {
        if samples.len() >= sample_limit {
            break;
        }
        samples.push(DataRowDiffSample {
            diff_type: "missing_in_target".to_string(),
            key: row_to_public_map(
                row,
                &internal.key_canonicals,
                &internal.output_name_by_canonical,
            ),
            source_row: Some(row_to_public_map(
                row,
                &row_fields,
                &internal.output_name_by_canonical,
            )),
            target_row: None,
            changed_columns: Vec::new(),
        });
    }

    for row in &internal.extra_rows {
        if samples.len() >= sample_limit {
            break;
        }
        samples.push(DataRowDiffSample {
            diff_type: "extra_in_target".to_string(),
            key: row_to_public_map(
                row,
                &internal.key_canonicals,
                &internal.output_name_by_canonical,
            ),
            source_row: None,
            target_row: Some(row_to_public_map(
                row,
                &row_fields,
                &internal.output_name_by_canonical,
            )),
            changed_columns: Vec::new(),
        });
    }

    for changed in &internal.changed_rows {
        if samples.len() >= sample_limit {
            break;
        }
        samples.push(DataRowDiffSample {
            diff_type: "changed".to_string(),
            key: row_to_public_map(
                &changed.source_row,
                &internal.key_canonicals,
                &internal.output_name_by_canonical,
            ),
            source_row: Some(row_to_public_map(
                &changed.source_row,
                &row_fields,
                &internal.output_name_by_canonical,
            )),
            target_row: Some(row_to_public_map(
                &changed.target_row,
                &row_fields,
                &internal.output_name_by_canonical,
            )),
            changed_columns: canonical_list_to_display(
                &changed.changed_canonicals,
                &internal.output_name_by_canonical,
            ),
        });
    }


    samples
}

// =====================================================
// EXPORTED FUNCTIONS
// =====================================================

pub async fn compare_table_data_with_state(
    app_state: &AppState,
    request: DataCompareRequest,
) -> Result<DataCompareResult, String> {
    let sample_limit = clamp_data_compare_sample_limit(request.sample_limit);
    let internal = compute_data_compare_internal(app_state, &request).await?;
    let key_columns =
        canonical_list_to_display(&internal.key_canonicals, &internal.output_name_by_canonical);
    let compare_columns = canonical_list_to_display(
        &internal.compare_canonicals,
        &internal.output_name_by_canonical,
    );
    let samples = build_data_compare_samples(&internal, sample_limit);

    Ok(DataCompareResult {
        source_database: internal.source_database.clone(),
        source_table: internal.source_table.clone(),
        target_database: internal.target_database.clone(),
        target_table: internal.target_table.clone(),
        key_columns,
        compare_columns,
        summary: internal.summary.clone(),
        samples,
        warnings: internal.warnings,
    })
}

pub async fn generate_data_sync_script_with_state(
    app_state: &AppState,
    request: DataCompareRequest,
) -> Result<DataSyncPlan, String> {
    let include_inserts = request.include_inserts.unwrap_or(true);
    let include_updates = request.include_updates.unwrap_or(true);
    let include_deletes = request.include_deletes.unwrap_or(false);
    let wrap_in_transaction = request.wrap_in_transaction.unwrap_or(true);
    let statement_limit = clamp_data_compare_statement_limit(request.statement_limit);

    if !include_inserts && !include_updates && !include_deletes {
        return Err("At least one sync action must be enabled (insert/update/delete).".to_string());
    }

    let internal = compute_data_compare_internal(app_state, &request).await?;
    let key_columns =
        canonical_list_to_display(&internal.key_canonicals, &internal.output_name_by_canonical);
    let compare_columns = canonical_list_to_display(
        &internal.compare_canonicals,
        &internal.output_name_by_canonical,
    );

    let mut warnings = internal.warnings.clone();
    if include_deletes && internal.summary.extra_in_target > 0 {
        warnings.push("Delete sync is enabled. Extra rows in target will be deleted.".to_string());
    }
    if !include_deletes && internal.summary.extra_in_target > 0 {
        warnings.push(
            "Delete sync is disabled. Extra target rows will remain after applying the script."
                .to_string(),
        );
    }
    if !include_inserts && internal.summary.missing_in_target > 0 {
        warnings.push(
            "Insert sync is disabled. Missing target rows will remain after applying the script."
                .to_string(),
        );
    }
    if !include_updates && internal.summary.changed > 0 {
        warnings.push("Update sync is disabled. Changed rows will remain out of sync.".to_string());
    }

    let qualified_target_table = qualified_table_name(
        &internal.db_type,
        &internal.target_database,
        &internal.target_table,
    );

    let mut lines = Vec::new();
    lines.push("-- TactileSQL Data Compare Sync Script".to_string());
    lines.push(format!(
        "-- Source: {}.{}",
        internal.source_database, internal.source_table
    ));
    lines.push(format!(
        "-- Target: {}.{}",
        internal.target_database, internal.target_table
    ));
    lines.push(format!(
        "-- Generated at: {}",
        chrono::Utc::now().to_rfc3339()
    ));
    lines.push(format!(
        "-- Key Columns: {}",
        if key_columns.is_empty() {
            "(none)".to_string()
        } else {
            key_columns.join(", ")
        }
    ));
    lines.push(format!(
        "-- Compare Columns: {}",
        if compare_columns.is_empty() {
            "(none)".to_string()
        } else {
            compare_columns.join(", ")
        }
    ));
    lines.push(String::new());

    if wrap_in_transaction {
        lines.push("BEGIN;".to_string());
        lines.push(String::new());
    }

    let mut statement_counts = DataSyncStatementCounts {
        inserts: 0,
        updates: 0,
        deletes: 0,
        total: 0,
    };
    let mut truncated = false;

    if include_inserts {
        for row in &internal.missing_rows {
            if statement_counts.total >= statement_limit {
                truncated = true;
                break;
            }
            lines.push(build_insert_statement_for_row(
                &internal.db_type,
                &qualified_target_table,
                row,
                &internal.insert_canonicals,
                &internal.target_name_by_canonical,
            )?);
            statement_counts.inserts += 1;
            statement_counts.total += 1;
        }
    }

    if include_updates && !truncated {
        for changed in &internal.changed_rows {
            if statement_counts.total >= statement_limit {
                truncated = true;
                break;
            }
            if let Some(statement) = build_update_statement_for_row(
                &internal.db_type,
                &qualified_target_table,
                &changed.source_row,
                &changed.changed_canonicals,
                &internal.key_canonicals,
                &internal.target_name_by_canonical,
            )? {
                lines.push(statement);
                statement_counts.updates += 1;
                statement_counts.total += 1;
            }
        }
    }

    if include_deletes && !truncated {
        for row in &internal.extra_rows {
            if statement_counts.total >= statement_limit {
                truncated = true;
                break;
            }
            lines.push(build_delete_statement_for_row(
                &internal.db_type,
                &qualified_target_table,
                row,
                &internal.key_canonicals,
                &internal.target_name_by_canonical,
            )?);
            statement_counts.deletes += 1;
            statement_counts.total += 1;
        }
    }

    if wrap_in_transaction {
        lines.push(String::new());
        lines.push("COMMIT;".to_string());
    }

    if truncated {
        warnings.push(format!(
            "Statement limit reached ({}). Generated script is truncated.",
            statement_limit
        ));
    }

    Ok(DataSyncPlan {
        script: lines.join("\n"),
        key_columns,
        compare_columns,
        summary: internal.summary,
        statement_counts,
        warnings,
        truncated,
    })
}

#[tauri::command]
pub async fn compare_table_data(
    app_state: State<'_, AppState>,
    request: DataCompareRequest,
) -> Result<DataCompareResult, String> {
    compare_table_data_with_state(app_state.inner(), request).await
}

#[tauri::command]
pub async fn generate_data_sync_script(
    app_state: State<'_, AppState>,
    request: DataCompareRequest,
) -> Result<DataSyncPlan, String> {
    generate_data_sync_script_with_state(app_state.inner(), request).await
}

#[cfg(test)]
mod tests;
