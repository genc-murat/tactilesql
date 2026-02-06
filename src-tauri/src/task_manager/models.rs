use chrono::{DateTime, Duration, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, HashSet};

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    #[default]
    SqlScript,
    Backup,
    SchemaSnapshot,
    DataCompareSync,
    DataTransferMigration,
    Composite,
}

impl TaskType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SqlScript => "sql_script",
            Self::Backup => "backup",
            Self::SchemaSnapshot => "schema_snapshot",
            Self::DataCompareSync => "data_compare_sync",
            Self::DataTransferMigration => "data_transfer_migration",
            Self::Composite => "composite",
        }
    }

    pub fn from_db(value: &str) -> Result<Self, String> {
        match value {
            "sql_script" => Ok(Self::SqlScript),
            "backup" => Ok(Self::Backup),
            "schema_snapshot" => Ok(Self::SchemaSnapshot),
            "data_compare_sync" => Ok(Self::DataCompareSync),
            "data_transfer_migration" => Ok(Self::DataTransferMigration),
            "composite" => Ok(Self::Composite),
            _ => Err(format!("Invalid task type in storage: {}", value)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    #[default]
    Active,
    Paused,
    Disabled,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Disabled => "disabled",
        }
    }

    pub fn from_db(value: &str) -> Result<Self, String> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "disabled" => Ok(Self::Disabled),
            _ => Err(format!("Invalid task status in storage: {}", value)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TriggerType {
    #[default]
    OneShot,
    Interval,
    Cron,
}

impl TriggerType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OneShot => "one_shot",
            Self::Interval => "interval",
            Self::Cron => "cron",
        }
    }

    pub fn from_db(value: &str) -> Result<Self, String> {
        match value {
            "one_shot" => Ok(Self::OneShot),
            "interval" => Ok(Self::Interval),
            "cron" => Ok(Self::Cron),
            _ => Err(format!("Invalid trigger type in storage: {}", value)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    #[default]
    Queued,
    Running,
    Success,
    Failed,
    Cancelled,
}

impl RunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Success => "success",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_db(value: &str) -> Result<Self, String> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "success" => Ok(Self::Success),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(format!("Invalid run status in storage: {}", value)),
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Success | Self::Failed | Self::Cancelled)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompositeStepStatus {
    #[default]
    Pending,
    Running,
    Success,
    Failed,
    Skipped,
}

impl CompositeStepStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Success => "success",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
        }
    }

    pub fn from_db(value: &str) -> Result<Self, String> {
        match value {
            "pending" => Ok(Self::Pending),
            "running" => Ok(Self::Running),
            "success" => Ok(Self::Success),
            "failed" => Ok(Self::Failed),
            "skipped" => Ok(Self::Skipped),
            _ => Err(format!("Invalid composite step status in storage: {}", value)),
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Success | Self::Failed | Self::Skipped)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    #[default]
    Info,
    Warning,
    Error,
    Debug,
}

impl LogLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Error => "error",
            Self::Debug => "debug",
        }
    }

    pub fn from_db(value: &str) -> Result<Self, String> {
        match value {
            "info" => Ok(Self::Info),
            "warning" => Ok(Self::Warning),
            "error" => Ok(Self::Error),
            "debug" => Ok(Self::Debug),
            _ => Err(format!("Invalid log level in storage: {}", value)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MisfirePolicy {
    #[default]
    FireNow,
    Skip,
    Reschedule,
}

impl MisfirePolicy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FireNow => "fire_now",
            Self::Skip => "skip",
            Self::Reschedule => "reschedule",
        }
    }

    pub fn from_db(value: &str) -> Result<Self, String> {
        match value {
            "fire_now" => Ok(Self::FireNow),
            "skip" => Ok(Self::Skip),
            "reschedule" => Ok(Self::Reschedule),
            _ => Err(format!("Invalid misfire policy in storage: {}", value)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SchedulerState {
    #[default]
    Running,
    Paused,
    Disabled,
}

impl SchedulerState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Disabled => "disabled",
        }
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "running" => Ok(Self::Running),
            "paused" => Ok(Self::Paused),
            "disabled" => Ok(Self::Disabled),
            _ => Err(format!("Invalid scheduler state: {}", value)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RetryPolicy {
    #[serde(default)]
    pub max_attempts: u32,
    #[serde(default)]
    pub backoff_ms: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskDefinition {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "taskType")]
    pub task_type: TaskType,
    pub status: TaskStatus,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub tags: Vec<String>,
    pub owner: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub last_run_status: Option<RunStatus>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskTrigger {
    pub id: String,
    pub task_id: String,
    #[serde(rename = "triggerType")]
    pub trigger_type: TriggerType,
    pub cron_expression: Option<String>,
    pub interval_seconds: Option<i64>,
    pub run_at: Option<DateTime<Utc>>,
    pub timezone: Option<String>,
    pub misfire_policy: MisfirePolicy,
    pub retry_policy: RetryPolicy,
    pub enabled: bool,
    pub next_run_at: Option<DateTime<Utc>>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub claim_owner: Option<String>,
    pub claim_until: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRun {
    pub id: String,
    pub task_id: String,
    pub trigger_id: Option<String>,
    pub status: RunStatus,
    pub attempt: i32,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    #[serde(default)]
    pub run_metadata: Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunLog {
    pub id: i64,
    pub run_id: String,
    pub task_id: String,
    pub level: LogLevel,
    pub message: String,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub log_metadata: Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskAuditLog {
    pub id: i64,
    pub event_type: String,
    pub task_id: Option<String>,
    pub actor: Option<String>,
    pub message: String,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub audit_metadata: Value,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskAuditLogsRequest {
    #[serde(rename = "taskId")]
    pub task_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskLogRetentionPolicy {
    pub retention_days: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PurgeTaskHistoryResult {
    pub retention_days: i64,
    pub cutoff_at: DateTime<Utc>,
    pub deleted_run_logs: i64,
    pub deleted_runs: i64,
    pub deleted_audit_logs: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompositeStepRun {
    pub id: i64,
    pub run_id: String,
    pub task_id: String,
    #[serde(rename = "stepKey")]
    pub step_key: String,
    pub position: i32,
    pub status: CompositeStepStatus,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    #[serde(default)]
    pub step_metadata: Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "taskType")]
    pub task_type: TaskType,
    #[serde(default)]
    pub status: TaskStatus,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub tags: Vec<String>,
    pub owner: Option<String>,
}

impl CreateTaskRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Task name cannot be empty".to_string());
        }
        validate_task_payload(&self.task_type, &self.payload)?;
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "taskType")]
    pub task_type: Option<TaskType>,
    pub status: Option<TaskStatus>,
    pub payload: Option<Value>,
    pub tags: Option<Vec<String>>,
    pub owner: Option<String>,
}

impl UpdateTaskRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.task_id.trim().is_empty() {
            return Err("Task id is required".to_string());
        }
        if let Some(name) = &self.name {
            if name.trim().is_empty() {
                return Err("Task name cannot be empty".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskTriggerRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "triggerType")]
    pub trigger_type: TriggerType,
    #[serde(rename = "cronExpression")]
    pub cron_expression: Option<String>,
    #[serde(rename = "intervalSeconds")]
    pub interval_seconds: Option<i64>,
    #[serde(rename = "runAt")]
    pub run_at: Option<DateTime<Utc>>,
    pub timezone: Option<String>,
    #[serde(rename = "misfirePolicy", default)]
    pub misfire_policy: MisfirePolicy,
    #[serde(rename = "retryPolicy", default)]
    pub retry_policy: RetryPolicy,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl CreateTaskTriggerRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.task_id.trim().is_empty() {
            return Err("Task id is required for trigger".to_string());
        }
        validate_trigger_fields(
            &self.trigger_type,
            self.cron_expression.as_deref(),
            self.interval_seconds,
            self.run_at,
        )
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskTriggerRequest {
    #[serde(rename = "triggerId")]
    pub trigger_id: String,
    #[serde(rename = "triggerType")]
    pub trigger_type: Option<TriggerType>,
    #[serde(rename = "cronExpression")]
    pub cron_expression: Option<String>,
    #[serde(rename = "intervalSeconds")]
    pub interval_seconds: Option<i64>,
    #[serde(rename = "runAt")]
    pub run_at: Option<DateTime<Utc>>,
    pub timezone: Option<String>,
    #[serde(rename = "misfirePolicy")]
    pub misfire_policy: Option<MisfirePolicy>,
    #[serde(rename = "retryPolicy")]
    pub retry_policy: Option<RetryPolicy>,
    pub enabled: Option<bool>,
}

impl UpdateTaskTriggerRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.trigger_id.trim().is_empty() {
            return Err("Trigger id is required".to_string());
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksRequest {
    pub status: Option<TaskStatus>,
    #[serde(rename = "taskType")]
    pub task_type: Option<TaskType>,
    pub owner: Option<String>,
    pub tag: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    #[serde(rename = "sortBy")]
    pub sort_by: Option<String>,
    #[serde(rename = "sortDesc")]
    pub sort_desc: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskTriggersRequest {
    #[serde(rename = "taskId")]
    pub task_id: Option<String>,
    pub enabled: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskRunsRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub limit: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompositeTaskStep {
    #[serde(rename = "stepKey")]
    pub step_key: String,
    pub position: i32,
    #[serde(rename = "taskType")]
    pub task_type: Option<TaskType>,
    #[serde(rename = "referencedTaskId")]
    pub referenced_task_id: Option<String>,
    #[serde(default)]
    pub payload: Value,
    #[serde(rename = "onError")]
    pub on_error: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompositeTaskEdge {
    #[serde(rename = "fromStepKey")]
    pub from_step_key: String,
    #[serde(rename = "toStepKey")]
    pub to_step_key: String,
    pub condition: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompositeTaskGraph {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub steps: Vec<CompositeTaskStep>,
    pub edges: Vec<CompositeTaskEdge>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCompositeTaskGraphRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub steps: Vec<CompositeTaskStep>,
    #[serde(default)]
    pub edges: Vec<CompositeTaskEdge>,
}

impl UpsertCompositeTaskGraphRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.task_id.trim().is_empty() {
            return Err("taskId is required".to_string());
        }
        if self.steps.is_empty() {
            return Err("Composite graph requires at least one step".to_string());
        }

        let mut step_keys = BTreeSet::new();
        for step in &self.steps {
            let step_key = step.step_key.trim();
            if step_key.is_empty() {
                return Err("Composite step key cannot be empty".to_string());
            }
            if !step_keys.insert(step_key.to_string()) {
                return Err(format!("Duplicate composite step key '{}'", step_key));
            }

            if let Some(task_type) = &step.task_type {
                if matches!(task_type, TaskType::Composite) {
                    return Err("Nested composite task type is not allowed in steps".to_string());
                }
            }

            let has_reference = step
                .referenced_task_id
                .as_ref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false);
            let has_inline = step.task_type.is_some();
            if !has_reference && !has_inline {
                return Err(format!(
                    "Composite step '{}' requires referencedTaskId or taskType",
                    step_key
                ));
            }
            if has_inline && !step.payload.is_object() {
                return Err(format!(
                    "Composite step '{}' payload must be a JSON object",
                    step_key
                ));
            }
        }

        for edge in &self.edges {
            let from_step_key = edge.from_step_key.trim();
            let to_step_key = edge.to_step_key.trim();
            if from_step_key.is_empty() || to_step_key.is_empty() {
                return Err("Composite edges require non-empty fromStepKey/toStepKey".to_string());
            }
            if !step_keys.contains(from_step_key) || !step_keys.contains(to_step_key) {
                return Err(format!(
                    "Composite edge '{}' -> '{}' references unknown step key",
                    from_step_key, to_step_key
                ));
            }
        }

        if let Some(cycle_path) = detect_composite_cycle(&self.edges) {
            return Err(format!(
                "Composite graph contains cycle: {}",
                cycle_path.join(" -> ")
            ));
        }

        Ok(())
    }
}

pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for tag in tags {
        let normalized = tag.trim().to_lowercase();
        if normalized.is_empty() {
            continue;
        }
        if out.iter().any(|existing| existing == &normalized) {
            continue;
        }
        out.push(normalized);
    }
    out
}

pub fn validate_task_payload(task_type: &TaskType, payload: &Value) -> Result<(), String> {
    if !payload.is_object() {
        return Err("Task payload must be a JSON object".to_string());
    }

    match task_type {
        TaskType::SqlScript => {
            if payload_string(payload, &["sql", "query", "script"]).is_none() {
                return Err(
                    "sql_script payload requires one of: sql, query, script".to_string(),
                );
            }
        }
        TaskType::Backup => {
            if payload_string(payload, &["database", "schema", "dbName"]).is_none() {
                return Err("backup payload requires one of: database, schema, dbName".to_string());
            }
        }
        TaskType::SchemaSnapshot => {}
        TaskType::DataCompareSync => {
            if payload_string(payload, &["sourceDatabase", "sourceSchema", "sourceDb"]).is_none() {
                return Err("data_compare_sync payload requires sourceDatabase".to_string());
            }
            if payload_string(payload, &["sourceTable"]).is_none() {
                return Err("data_compare_sync payload requires sourceTable".to_string());
            }
            if payload_string(payload, &["targetDatabase", "targetSchema", "targetDb"]).is_none() {
                return Err("data_compare_sync payload requires targetDatabase".to_string());
            }
            if payload_string(payload, &["targetTable"]).is_none() {
                return Err("data_compare_sync payload requires targetTable".to_string());
            }
        }
        TaskType::DataTransferMigration => {
            let request_payload =
                payload_object(payload, &["request", "plan", "transferRequest"]).unwrap_or(payload);

            if payload_string(request_payload, &["sourceConnectionId"]).is_none() {
                return Err(
                    "data_transfer_migration payload requires sourceConnectionId".to_string(),
                );
            }
            if payload_string(request_payload, &["targetConnectionId"]).is_none() {
                return Err(
                    "data_transfer_migration payload requires targetConnectionId".to_string(),
                );
            }
            if payload_string(request_payload, &["sourceDatabase"]).is_none() {
                return Err("data_transfer_migration payload requires sourceDatabase".to_string());
            }
            if payload_string(request_payload, &["targetDatabase"]).is_none() {
                return Err("data_transfer_migration payload requires targetDatabase".to_string());
            }

            let objects = request_payload
                .get("objects")
                .and_then(Value::as_array)
                .ok_or("data_transfer_migration payload requires objects array".to_string())?;
            if objects.is_empty() {
                return Err("data_transfer_migration payload requires at least one object".to_string());
            }

            for (index, object) in objects.iter().enumerate() {
                let object_label = format!("data_transfer_migration object {}", index + 1);
                if !object.is_object() {
                    return Err(format!("{} must be a JSON object", object_label));
                }
                if payload_string(object, &["sourceTable"]).is_none() {
                    return Err(format!("{} requires sourceTable", object_label));
                }

                let mode = payload_string(object, &["mode"])
                    .unwrap_or_else(|| "append".to_string())
                    .to_ascii_lowercase();
                if !matches!(mode.as_str(), "append" | "replace" | "upsert") {
                    return Err(format!(
                        "{} has invalid mode '{}'",
                        object_label, mode
                    ));
                }

                let sink_type = payload_string(object, &["sinkType"])
                    .unwrap_or_else(|| "database".to_string())
                    .to_ascii_lowercase();
                if !matches!(sink_type.as_str(), "database" | "csv" | "jsonl" | "sql") {
                    return Err(format!(
                        "{} has invalid sinkType '{}'",
                        object_label, sink_type
                    ));
                }
                if sink_type != "database" {
                    let has_sink_path = payload_string(object, &["sinkPath"])
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or(false);
                    if !has_sink_path {
                        return Err(format!(
                            "{} uses '{}' sink and requires sinkPath",
                            object_label, sink_type
                        ));
                    }
                }

                if mode == "upsert" {
                    if !matches!(sink_type.as_str(), "database" | "sql") {
                        return Err(format!(
                            "{} uses upsert mode with '{}' sink; upsert is only valid for database/sql sinks",
                            object_label, sink_type
                        ));
                    }

                    let has_key_columns = object
                        .get("keyColumns")
                        .and_then(Value::as_array)
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::trim)
                                .any(|value| !value.is_empty())
                        })
                        .unwrap_or(false);
                    if !has_key_columns {
                        return Err(format!(
                            "{} uses upsert mode and requires keyColumns",
                            object_label
                        ));
                    }
                }
            }
        }
        TaskType::Composite => {
            if payload.get("steps").is_some() {
                let has_steps = payload
                    .get("steps")
                    .and_then(Value::as_array)
                    .map(|steps| !steps.is_empty())
                    .unwrap_or(false);
                if !has_steps {
                    return Err("composite payload steps must be a non-empty array".to_string());
                }
            }
        }
    }

    Ok(())
}

pub fn compute_initial_next_run_at(
    trigger_type: &TriggerType,
    cron_expression: Option<&str>,
    interval_seconds: Option<i64>,
    run_at: Option<DateTime<Utc>>,
    from: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, String> {
    match trigger_type {
        TriggerType::OneShot => {
            let run_at = run_at.ok_or("one_shot trigger requires run_at".to_string())?;
            if run_at <= from {
                Ok(Some(from))
            } else {
                Ok(Some(run_at))
            }
        }
        TriggerType::Interval => {
            let seconds = interval_seconds.ok_or("interval trigger requires interval_seconds")?;
            if seconds <= 0 {
                return Err("interval_seconds must be > 0".to_string());
            }
            Ok(Some(from + Duration::seconds(seconds)))
        }
        TriggerType::Cron => {
            let expr = cron_expression
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
                .ok_or("cron trigger requires cron_expression".to_string())?;
            next_run_from_cron(expr, from)
        }
    }
}

pub fn compute_next_after_fire(trigger: &TaskTrigger, fired_at: DateTime<Utc>) -> Result<Option<DateTime<Utc>>, String> {
    match trigger.trigger_type {
        TriggerType::OneShot => Ok(None),
        TriggerType::Interval => {
            let seconds = trigger
                .interval_seconds
                .ok_or("interval trigger requires interval_seconds".to_string())?;
            if seconds <= 0 {
                return Err("interval_seconds must be > 0".to_string());
            }
            Ok(Some(fired_at + Duration::seconds(seconds)))
        }
        TriggerType::Cron => {
            let expr = trigger
                .cron_expression
                .as_deref()
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
                .ok_or("cron trigger requires cron_expression".to_string())?;
            next_run_from_cron(expr, fired_at)
        }
    }
}

pub fn validate_trigger_fields(
    trigger_type: &TriggerType,
    cron_expression: Option<&str>,
    interval_seconds: Option<i64>,
    run_at: Option<DateTime<Utc>>,
) -> Result<(), String> {
    match trigger_type {
        TriggerType::OneShot => {
            if run_at.is_none() {
                return Err("one_shot trigger requires run_at".to_string());
            }
        }
        TriggerType::Interval => {
            let seconds = interval_seconds.ok_or("interval trigger requires interval_seconds")?;
            if seconds <= 0 {
                return Err("interval_seconds must be > 0".to_string());
            }
        }
        TriggerType::Cron => {
            let expr = cron_expression
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
                .ok_or("cron trigger requires cron_expression".to_string())?;
            validate_cron_expression(expr)?;
        }
    }
    Ok(())
}

pub fn validate_cron_expression(expr: &str) -> Result<(), String> {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() != 5 {
        return Err("Cron expression must contain 5 fields: min hour day month dow".to_string());
    }

    parse_cron_field(parts[0], 0, 59)?;
    parse_cron_field(parts[1], 0, 23)?;

    if parts[2] != "*" || parts[3] != "*" || parts[4] != "*" {
        return Err("Current cron support is limited to '* * *' for day/month/dow".to_string());
    }

    Ok(())
}

fn next_run_from_cron(expr: &str, from: DateTime<Utc>) -> Result<Option<DateTime<Utc>>, String> {
    validate_cron_expression(expr)?;
    let parts: Vec<&str> = expr.split_whitespace().collect();
    let minute_set = parse_cron_field(parts[0], 0, 59)?;
    let hour_set = parse_cron_field(parts[1], 0, 23)?;

    let mut probe = from + Duration::minutes(1);
    probe = probe
        .with_second(0)
        .and_then(|dt| dt.with_nanosecond(0))
        .ok_or("Failed to normalize cron probe datetime".to_string())?;

    for _ in 0..(366 * 24 * 60) {
        if hour_set.contains(&(probe.hour() as u32)) && minute_set.contains(&(probe.minute() as u32))
        {
            return Ok(Some(probe));
        }
        probe += Duration::minutes(1);
    }

    Ok(None)
}

fn parse_cron_field(field: &str, min: u32, max: u32) -> Result<BTreeSet<u32>, String> {
    let mut out = BTreeSet::new();
    for part in field.split(',') {
        let token = part.trim();
        if token.is_empty() {
            return Err(format!("Invalid cron token '{}'", field));
        }

        if token == "*" {
            for value in min..=max {
                out.insert(value);
            }
            continue;
        }

        if let Some(step_raw) = token.strip_prefix("*/") {
            let step: u32 = step_raw
                .parse()
                .map_err(|_| format!("Invalid cron step '{}'", token))?;
            if step == 0 {
                return Err("Cron step cannot be 0".to_string());
            }
            let mut value = min;
            while value <= max {
                out.insert(value);
                value = value.saturating_add(step);
                if value == u32::MAX {
                    break;
                }
            }
            continue;
        }

        if let Some((start_raw, end_raw)) = token.split_once('-') {
            let start: u32 = start_raw
                .parse()
                .map_err(|_| format!("Invalid cron range '{}'", token))?;
            let end: u32 = end_raw
                .parse()
                .map_err(|_| format!("Invalid cron range '{}'", token))?;
            if start > end || start < min || end > max {
                return Err(format!("Cron range out of bounds '{}'", token));
            }
            for value in start..=end {
                out.insert(value);
            }
            continue;
        }

        let value: u32 = token
            .parse()
            .map_err(|_| format!("Invalid cron value '{}'", token))?;
        if value < min || value > max {
            return Err(format!("Cron value out of bounds '{}'", token));
        }
        out.insert(value);
    }

    if out.is_empty() {
        return Err("Cron field resolved to empty set".to_string());
    }

    Ok(out)
}

fn payload_object<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .find_map(|key| payload.get(*key))
        .filter(|value| value.is_object())
}

fn payload_string(payload: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| payload.get(*key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn detect_composite_cycle(edges: &[CompositeTaskEdge]) -> Option<Vec<String>> {
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();
    for edge in edges {
        let from = edge.from_step_key.trim();
        let to = edge.to_step_key.trim();
        if from.is_empty() || to.is_empty() {
            continue;
        }
        adjacency
            .entry(from.to_string())
            .or_default()
            .push(to.to_string());
    }

    let nodes = adjacency.keys().cloned().collect::<Vec<String>>();
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    let mut stack = Vec::<String>::new();

    for node in nodes {
        if visited.contains(&node) {
            continue;
        }
        if let Some(path) = detect_cycle_dfs(
            &node,
            &adjacency,
            &mut visiting,
            &mut visited,
            &mut stack,
        ) {
            return Some(path);
        }
    }

    None
}

fn detect_cycle_dfs(
    node: &str,
    adjacency: &HashMap<String, Vec<String>>,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
    stack: &mut Vec<String>,
) -> Option<Vec<String>> {
    if visiting.contains(node) {
        if let Some(index) = stack.iter().position(|value| value == node) {
            let mut path = stack[index..].to_vec();
            path.push(node.to_string());
            return Some(path);
        }
        return Some(vec![node.to_string(), node.to_string()]);
    }
    if visited.contains(node) {
        return None;
    }

    visiting.insert(node.to_string());
    stack.push(node.to_string());

    if let Some(neighbors) = adjacency.get(node) {
        for neighbor in neighbors {
            if let Some(path) = detect_cycle_dfs(neighbor, adjacency, visiting, visited, stack) {
                return Some(path);
            }
        }
    }

    visiting.remove(node);
    visited.insert(node.to_string());
    stack.pop();
    None
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{CompositeTaskEdge, CompositeTaskStep, TaskType, UpsertCompositeTaskGraphRequest};
    use serde_json::json;

    fn inline_step(step_key: &str, position: i32) -> CompositeTaskStep {
        CompositeTaskStep {
            step_key: step_key.to_string(),
            position,
            task_type: Some(TaskType::SqlScript),
            referenced_task_id: None,
            payload: json!({
                "sql": "SELECT 1"
            }),
            on_error: None,
            enabled: true,
        }
    }

    #[test]
    fn composite_graph_validation_rejects_cycle() {
        let request = UpsertCompositeTaskGraphRequest {
            task_id: "task-cycle".to_string(),
            steps: vec![inline_step("step_a", 1), inline_step("step_b", 2)],
            edges: vec![
                CompositeTaskEdge {
                    from_step_key: "step_a".to_string(),
                    to_step_key: "step_b".to_string(),
                    condition: None,
                },
                CompositeTaskEdge {
                    from_step_key: "step_b".to_string(),
                    to_step_key: "step_a".to_string(),
                    condition: None,
                },
            ],
        };

        let error = request.validate().expect_err("cycle should be rejected");
        assert!(error.contains("cycle"), "unexpected error: {error}");
    }

    #[test]
    fn composite_graph_validation_accepts_acyclic_dependencies() {
        let request = UpsertCompositeTaskGraphRequest {
            task_id: "task-acyclic".to_string(),
            steps: vec![
                inline_step("extract", 1),
                inline_step("transform", 2),
                inline_step("load", 3),
            ],
            edges: vec![
                CompositeTaskEdge {
                    from_step_key: "extract".to_string(),
                    to_step_key: "transform".to_string(),
                    condition: None,
                },
                CompositeTaskEdge {
                    from_step_key: "transform".to_string(),
                    to_step_key: "load".to_string(),
                    condition: None,
                },
            ],
        };

        assert!(request.validate().is_ok());
    }
}
