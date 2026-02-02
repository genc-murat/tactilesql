// =====================================================
// COMMON DATABASE TYPES AND STRUCTURES
// =====================================================

use serde::{Deserialize, Serialize};
use sqlx::{Pool, MySql, Postgres, Sqlite};
use std::sync::Arc;
use tokio::sync::Mutex;

// --- Database Type Enum ---
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    #[default]
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
    pub schema_tracker_store: Arc<Mutex<Option<crate::schema_tracker::storage::SchemaTrackerStore>>>,
    pub quality_analyzer_store: Arc<Mutex<Option<crate::quality_analyzer::storage::QualityAnalyzerStore>>>,
    pub dependency_engine_store: Arc<Mutex<Option<crate::dependency_engine::storage::DependencyEngineStore>>>,
    pub local_db_pool: Arc<Mutex<Option<Pool<Sqlite>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            mysql_pool: Arc::new(Mutex::new(None)),
            postgres_pool: Arc::new(Mutex::new(None)),
            active_db_type: Arc::new(Mutex::new(DatabaseType::MySQL)),
            encryption_key: Arc::new(Mutex::new(None)),
            awareness_store: Arc::new(Mutex::new(None)),
            schema_tracker_store: Arc::new(Mutex::new(None)),
            quality_analyzer_store: Arc::new(Mutex::new(None)),
            dependency_engine_store: Arc::new(Mutex::new(None)),
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
#[derive(Serialize, Debug)]
pub struct ServerStatus {
    pub uptime: i64,
    pub threads_connected: i64,
    pub threads_running: i64,
    pub questions: i64,
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
    pub suggestion: String,
    pub reason: String,
}
