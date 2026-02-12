// =====================================================
// COMMON DATABASE TYPES AND STRUCTURES
// =====================================================

use serde::{Deserialize, Serialize};
use sqlx::{MySql, Pool, Postgres, Sqlite};
use std::sync::Arc;
use tokio::sync::Mutex;

// --- Database Type Enum ---
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    #[default]
    Disconnected,
    MySQL,
    PostgreSQL,
}

// --- State Management ---
pub struct AppState {
    pub mysql_pool: Arc<Mutex<Option<Pool<MySql>>>>,
    pub postgres_pool: Arc<Mutex<Option<Pool<Postgres>>>>,
    pub active_db_type: Arc<Mutex<DatabaseType>>,
    pub encryption_key: Arc<Mutex<Option<Vec<u8>>>>,
    pub awareness_store: Arc<Mutex<Option<crate::awareness::store::AwarenessStore>>>,
    pub schema_tracker_store:
        Arc<Mutex<Option<crate::schema_tracker::storage::SchemaTrackerStore>>>,
    pub quality_analyzer_store:
        Arc<Mutex<Option<crate::quality_analyzer::storage::QualityAnalyzerStore>>>,
    pub dependency_engine_store:
        Arc<Mutex<Option<crate::dependency_engine::storage::DependencyEngineStore>>>,
    pub er_diagram_store: Arc<Mutex<Option<crate::er_diagram::storage::ErDiagramStore>>>,
    pub query_story_store: Arc<Mutex<Option<crate::query_story::storage::QueryStoryStore>>>,
    pub task_manager_store: Arc<Mutex<Option<crate::task_manager::storage::TaskManagerStore>>>,
    pub monitor_store: Arc<Mutex<Option<crate::db::diagnostics::monitor_store::MonitorStore>>>,
    pub last_monitor_tick: Arc<Mutex<i64>>,
    pub last_monitor_status: Arc<Mutex<Option<ServerStatus>>>,
    pub task_scheduler_state: Arc<Mutex<crate::task_manager::models::SchedulerState>>,
    pub task_last_retention_purge_epoch: Arc<Mutex<i64>>,
    pub local_db_pool: Arc<Mutex<Option<Pool<Sqlite>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            mysql_pool: Arc::new(Mutex::new(None)),
            postgres_pool: Arc::new(Mutex::new(None)),
            active_db_type: Arc::new(Mutex::new(DatabaseType::Disconnected)),
            encryption_key: Arc::new(Mutex::new(None)),
            awareness_store: Arc::new(Mutex::new(None)),
            schema_tracker_store: Arc::new(Mutex::new(None)),
            quality_analyzer_store: Arc::new(Mutex::new(None)),
            dependency_engine_store: Arc::new(Mutex::new(None)),
            er_diagram_store: Arc::new(Mutex::new(None)),
            query_story_store: Arc::new(Mutex::new(None)),
            task_manager_store: Arc::new(Mutex::new(None)),
            monitor_store: Arc::new(Mutex::new(None)),
            last_monitor_tick: Arc::new(Mutex::new(0)),
            last_monitor_status: Arc::new(Mutex::new(None)),
            task_scheduler_state: Arc::new(Mutex::new(
                crate::task_manager::models::SchedulerState::Running,
            )),
            task_last_retention_purge_epoch: Arc::new(Mutex::new(0)),
            local_db_pool: Arc::new(Mutex::new(None)),
        }
    }
}

impl Clone for AppState {
    fn clone(&self) -> Self {
        Self {
            mysql_pool: Arc::clone(&self.mysql_pool),
            postgres_pool: Arc::clone(&self.postgres_pool),
            active_db_type: Arc::clone(&self.active_db_type),
            encryption_key: Arc::clone(&self.encryption_key),
            awareness_store: Arc::clone(&self.awareness_store),
            schema_tracker_store: Arc::clone(&self.schema_tracker_store),
            quality_analyzer_store: Arc::clone(&self.quality_analyzer_store),
            dependency_engine_store: Arc::clone(&self.dependency_engine_store),
            er_diagram_store: Arc::clone(&self.er_diagram_store),
            query_story_store: Arc::clone(&self.query_story_store),
            task_manager_store: Arc::clone(&self.task_manager_store),
            monitor_store: Arc::clone(&self.monitor_store),
            last_monitor_tick: Arc::clone(&self.last_monitor_tick),
            last_monitor_status: Arc::clone(&self.last_monitor_status),
            task_scheduler_state: Arc::clone(&self.task_scheduler_state),
            task_last_retention_purge_epoch: Arc::clone(&self.task_last_retention_purge_epoch),
            local_db_pool: Arc::clone(&self.local_db_pool),
        }
    }
}

// --- Connection Configuration ---
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConnectionConfig {
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "dbType", default)]
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub database: Option<String>,
    #[serde(default)]
    pub password_encrypted: bool,
    pub color: Option<String>,
    // PostgreSQL specific
    #[serde(rename = "sslMode")]
    pub ssl_mode: Option<String>,
    pub schema: Option<String>,
    // SSH Tunnel
    #[serde(rename = "useSSHTunnel", default)]
    pub use_ssh_tunnel: bool,
    #[serde(rename = "sshHost")]
    pub ssh_host: Option<String>,
    #[serde(rename = "sshPort")]
    pub ssh_port: Option<u16>,
    #[serde(rename = "sshUsername")]
    pub ssh_username: Option<String>,
    #[serde(rename = "sshPassword")]
    pub ssh_password: Option<String>,
    #[serde(rename = "sshKeyPath")]
    pub ssh_key_path: Option<String>,
}

// --- Query Result ---
#[derive(Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

// --- Column Schema ---
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct ColumnSchema {
    pub name: String,
    pub data_type: String,
    pub column_type: String,
    pub is_nullable: bool,
    pub column_key: String,
    pub column_default: Option<String>,
    pub extra: String,
}

// --- Table Index ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TableIndex {
    pub name: String,
    pub column_name: String,
    pub non_unique: bool,
    pub index_type: String,
}

// --- Foreign Key ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ForeignKey {
    pub constraint_name: String,
    pub column_name: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub referenced_schema: Option<String>,
}

// --- Primary Key ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PrimaryKey {
    pub column_name: String,
    pub ordinal_position: i32,
}

// --- Constraint ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TableConstraint {
    pub name: String,
    pub constraint_type: String,
    pub column_name: String,
}

// --- Table Stats ---
#[derive(Serialize, Debug)]
pub struct TableStats {
    pub row_count: i64,
    pub data_size: i64,
    pub index_size: i64,
    pub auto_increment: Option<i64>,
}

// --- Trigger Info ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TriggerInfo {
    pub name: String,
    pub event: String,
    pub timing: String,
    pub table_name: String,
}

// --- Routine Info (Procedures/Functions) ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RoutineInfo {
    pub name: String,
    pub definer: String,
}

// --- Event Info ---
#[derive(Serialize, Debug)]
pub struct EventInfo {
    pub name: String,
    pub status: String,
    pub event_type: String,
}

// --- View Definition ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ViewDefinition {
    pub name: String,
    pub definition: String,
}

// --- MySQL User ---
#[derive(Serialize, Debug)]
pub struct MySqlUser {
    pub user: String,
    pub host: String,
    pub account_locked: bool,
    pub password_expired: bool,
}

// --- User Privilege ---
#[derive(Serialize, Debug)]
pub struct UserPrivilege {
    pub privilege: String,
    pub granted: bool,
}

#[derive(Serialize, Debug)]
pub struct UserPrivileges {
    pub global: Vec<UserPrivilege>,
    pub databases: Vec<String>,
}

// --- Server Status ---
#[derive(Serialize, Debug, Clone)]
pub struct ServerStatus {
    pub uptime: i64,
    pub threads_connected: i64,
    pub threads_running: i64,
    pub queries: i64,
    pub slow_queries: i64,
    pub connections: i64,
    pub bytes_received: i64,
    pub bytes_sent: i64,
}

// --- Process Info ---
#[derive(Serialize, Debug)]
pub struct ProcessInfo {
    pub id: i64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time: i64,
    pub state: Option<String>,
    pub info: Option<String>,
}

// --- Slow Query ---
#[allow(dead_code)]
#[derive(Serialize, Debug)]
pub struct SlowQuery {
    pub start_time: String,
    pub user_host: String,
    pub query_time: String,
    pub lock_time: String,
    pub rows_sent: i64,
    pub rows_examined: i64,
    pub sql_text: String,
}

// --- Lock Info ---
#[derive(Serialize, Debug)]
pub struct LockInfo {
    pub lock_id: String,
    pub lock_mode: String,
    pub lock_type: String,
    pub lock_table: String,
    pub lock_data: Option<String>,
}

// --- Lock/Deadlock Analysis ---
#[derive(Serialize, Debug, Clone)]
pub struct LockGraphEdge {
    pub waiting_process_id: i64,
    pub blocking_process_id: i64,
    pub wait_seconds: i64,
    pub object_name: Option<String>,
    pub lock_type: Option<String>,
    pub waiting_lock_mode: Option<String>,
    pub blocking_lock_mode: Option<String>,
    pub waiting_query: Option<String>,
    pub blocking_query: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct LockGraphNode {
    pub process_id: i64,
    pub role: String, // waiting | blocking | both
    pub blocked_count: i64,
    pub waiting_on_count: i64,
    pub max_wait_seconds: i64,
    pub sample_query: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct BlockingChain {
    pub process_chain: Vec<i64>,
    pub depth: i32,
    pub total_wait_seconds: i64,
    pub contains_cycle: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct LockRecommendation {
    pub severity: String, // critical | high | medium | low
    pub title: String,
    pub action: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct LockAnalysisSummary {
    pub total_edges: i64,
    pub waiting_sessions: i64,
    pub blocking_sessions: i64,
    pub max_wait_seconds: i64,
    pub max_chain_depth: i32,
    pub deadlock_cycles: i64,
}

#[derive(Serialize, Debug, Clone)]
pub struct LockAnalysis {
    pub db_type: String,      // mysql | postgresql
    pub generated_at: String, // RFC3339
    pub has_deadlock: bool,
    pub summary: LockAnalysisSummary,
    pub nodes: Vec<LockGraphNode>,
    pub edges: Vec<LockGraphEdge>,
    pub chains: Vec<BlockingChain>,
    pub recommendations: Vec<LockRecommendation>,
}

// --- SSH Tunnel Config ---
#[allow(dead_code)]
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SSHTunnelConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
}

// --- Query Analysis Result ---
#[derive(Serialize, Debug)]
pub struct QueryAnalysis {
    pub explain_result: Vec<serde_json::Value>,
    pub warnings: Vec<String>,
    pub suggestions: Vec<String>,
}

// --- Index Suggestion ---
#[derive(Serialize, Debug)]
pub struct IndexSuggestion {
    pub table_name: String,
    pub column_name: String,
    pub index_name: Option<String>,
    pub suggestion: String,
    pub reason: String,
}

// --- Index Usage ---
#[derive(Serialize, Debug)]
pub struct IndexUsage {
    pub index_name: String,
    pub total_ops: i64,
    pub reads: i64,
    pub writes: i64,
}

// --- Index Size ---
#[derive(Serialize, Debug)]
pub struct IndexSize {
    pub index_name: String,
    pub size_bytes: i64,
}

// --- Index Drop Simulation ---
#[derive(Serialize, Debug, Clone)]
pub struct IndexSimulationQueryDiff {
    pub query_hash: String,
    pub query_preview: String,
    pub before_cost: Option<f64>,
    pub after_cost: Option<f64>,
    pub delta_pct: Option<f64>,
    pub regression: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct IndexDropSimulation {
    pub database: String,
    pub table: String,
    pub index_name: String,
    pub mode: String,
    pub drop_sql: String,
    pub rollback_sql: String,
    pub analyzed_queries: i32,
    pub matched_queries: i32,
    pub failed_queries: i32,
    pub regressions: i32,
    pub avg_regression_pct: f64,
    pub worst_regression_pct: f64,
    pub coverage_ratio: f64,
    pub confidence_score: i32,
    pub query_diffs: Vec<IndexSimulationQueryDiff>,
    pub notes: Vec<String>,
}

// --- Capacity Metrics ---
#[derive(Serialize, Debug)]
pub struct CapacityMetrics {
    pub storage_bytes: i64,
    pub data_bytes: i64,
    pub index_bytes: i64,
    pub buffer_hit_ratio: f64,
    pub disk_read_bytes: i64,
    pub disk_write_bytes: i64,
}

// --- AI Index Recommendation ---
#[derive(Serialize, Debug)]
pub struct AiIndexRecommendation {
    pub columns: Vec<String>,
    pub index_type: String,
    pub reason: String,
    pub impact_score: i32,
    pub affected_queries: Vec<String>,
    pub estimated_benefit: String,
    pub create_sql: String,
}

#[derive(Serialize, Debug)]
pub struct AiIndexRecommendations {
    pub table_name: String,
    pub recommendations: Vec<AiIndexRecommendation>,
    pub analyzed_queries: i32,
    pub analysis_summary: String,
}

// --- Wait Event Summary ---
#[derive(Serialize, Debug, Clone)]
pub struct WaitEventSummary {
    pub event_type: String, // e.g., 'IO', 'Lock', 'CPU'
    pub event_name: String,
    pub total_waits: i64,
    pub total_latency_ms: f64,
    pub avg_latency_ms: f64,
    pub percentage: f64,
}

// --- Table Resource Usage ---
#[derive(Serialize, Debug, Clone)]
pub struct TableResourceUsage {
    pub schema: String,
    pub table: String,
    pub read_ops: i64,
    pub write_ops: i64,
    pub fetch_latency_ms: f64,
    pub insert_latency_ms: f64,
    pub update_latency_ms: f64,
    pub delete_latency_ms: f64,
}

// --- Bloat Info ---
#[derive(Serialize, Debug, Clone)]
pub struct BloatInfo {
    pub schema: String,
    pub table: String,
    pub bloat_pct: f64,
    pub wasted_bytes: i64,
    pub total_bytes: i64,
    pub table_type: String, // 'table' | 'index'
}

// --- Health Metric ---
#[derive(Serialize, Debug, Clone)]
pub struct HealthMetric {
    pub label: String,
    pub value: String,
    pub status: String, // 'healthy' | 'warning' | 'critical'
    pub description: Option<String>,
}

// --- Monitor Snapshot ---
#[derive(Serialize, Debug)]
pub struct MonitorSnapshot {
    pub server_status: ServerStatus,
    pub processes: Vec<ProcessInfo>,
    pub replication: serde_json::Value,
    pub slow_queries: Vec<SlowQuery>,
    pub locks: Vec<LockInfo>,
    pub lock_analysis: Option<LockAnalysis>,
    pub innodb_status: Option<String>,
    pub wait_events: Vec<WaitEventSummary>,
    pub table_usage: Vec<TableResourceUsage>,
    pub health_metrics: Vec<HealthMetric>,
}
