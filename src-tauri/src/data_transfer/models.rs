use crate::data_transfer::sink::DataTransferSinkType;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DataTransferMode {
    #[default]
    Append,
    Replace,
    Upsert,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataTransferObjectSpec {
    pub source_table: String,
    pub target_table: Option<String>,
    #[serde(default)]
    pub mode: DataTransferMode,
    #[serde(default)]
    pub key_columns: Vec<String>,
    #[serde(default)]
    pub sink_type: DataTransferSinkType,
    pub sink_path: Option<String>,
}

impl DataTransferObjectSpec {
    pub fn normalized_source_table(&self) -> String {
        self.source_table.trim().to_string()
    }

    pub fn normalized_target_table(&self) -> String {
        self.target_table
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| self.normalized_source_table())
    }

    pub fn normalized_key_columns(&self) -> Vec<String> {
        self.key_columns
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect()
    }

    pub fn normalized_sink_path(&self) -> Option<String> {
        self.sink_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataTransferPlanRequest {
    pub source_connection_id: String,
    pub target_connection_id: String,
    pub source_database: String,
    pub target_database: String,
    #[serde(default)]
    pub objects: Vec<DataTransferObjectSpec>,
    #[serde(default)]
    pub include_schema_migration: bool,
    #[serde(default = "default_true")]
    pub lock_guard: bool,
    pub mapping_profile: Option<String>,
}

impl DataTransferPlanRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.source_connection_id.trim().is_empty() {
            return Err("sourceConnectionId is required".to_string());
        }
        if self.target_connection_id.trim().is_empty() {
            return Err("targetConnectionId is required".to_string());
        }
        if self.source_database.trim().is_empty() {
            return Err("sourceDatabase is required".to_string());
        }
        if self.target_database.trim().is_empty() {
            return Err("targetDatabase is required".to_string());
        }
        if self.objects.is_empty() {
            return Err("At least one transfer object is required".to_string());
        }

        for (index, object) in self.objects.iter().enumerate() {
            let source_table = object.normalized_source_table();
            if source_table.is_empty() {
                return Err(format!(
                    "Object {} has an empty sourceTable value",
                    index + 1
                ));
            }

            if object.sink_type != DataTransferSinkType::Database
                && object.normalized_sink_path().is_none()
            {
                return Err(format!(
                    "Object {} ({}) uses '{}' sink but has no sinkPath",
                    index + 1,
                    source_table,
                    object.sink_type.as_str()
                ));
            }

            if matches!(object.mode, DataTransferMode::Upsert)
                && !matches!(
                    object.sink_type,
                    DataTransferSinkType::Database | DataTransferSinkType::Sql
                )
            {
                return Err(format!(
                    "Object {} ({}) uses upsert mode with '{}' sink; upsert is only valid for database/sql sinks",
                    index + 1,
                    source_table,
                    object.sink_type.as_str()
                ));
            }

            if matches!(object.mode, DataTransferMode::Upsert)
                && matches!(
                    object.sink_type,
                    DataTransferSinkType::Database | DataTransferSinkType::Sql
                )
                && object.normalized_key_columns().is_empty()
            {
                return Err(format!(
                    "Object {} ({}) uses upsert mode but has no keyColumns",
                    index + 1,
                    source_table
                ));
            }
        }

        Ok(())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataTransferSchemaMigrationPreflight {
    pub status: String,
    pub source_scope: String,
    pub target_scope: String,
    pub strategy: Option<String>,
    pub has_schema_changes: bool,
    pub new_table_count: usize,
    pub dropped_table_count: usize,
    pub modified_table_count: usize,
    pub breaking_change_count: usize,
    pub migration_warning_count: usize,
    pub external_command_count: usize,
    pub unsupported_statement_count: usize,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub migration_script_preview: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataTransferPlanPreview {
    pub plan_id: String,
    pub source_connection_id: String,
    pub target_connection_id: String,
    pub source_database: String,
    pub target_database: String,
    pub object_count: usize,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_migration_preflight: Option<DataTransferSchemaMigrationPreflight>,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartDataTransferRequest {
    pub plan: DataTransferPlanRequest,
    pub dry_run: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DataTransferRunStatus {
    #[default]
    Queued,
    Running,
    Success,
    Failed,
    Cancelled,
}

impl DataTransferRunStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            DataTransferRunStatus::Success
                | DataTransferRunStatus::Failed
                | DataTransferRunStatus::Cancelled
        )
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataTransferRunSummary {
    pub operation_id: String,
    pub plan_id: String,
    pub status: DataTransferRunStatus,
    pub progress_pct: u8,
    pub source_connection_id: String,
    pub target_connection_id: String,
    pub source_database: String,
    pub target_database: String,
    pub object_count: usize,
    pub processed_objects: usize,
    pub warning_count: usize,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_migration_preflight: Option<DataTransferSchemaMigrationPreflight>,
    pub dry_run: bool,
    pub started_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
}
