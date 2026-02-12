use sqlx::{Pool, Sqlite};
use crate::db_types::{ServerStatus};
use chrono::{DateTime, Utc};

pub struct MonitorStore {
    pool: Pool<Sqlite>,
}

impl MonitorStore {
    pub async fn new(pool: Pool<Sqlite>) -> Result<Self, String> {
        let store = Self { pool };
        store.init_schema().await?;
        Ok(store)
    }

    async fn init_schema(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS server_metrics_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                timestamp DATETIME NOT NULL,
                uptime INTEGER NOT NULL,
                threads_connected INTEGER NOT NULL,
                threads_running INTEGER NOT NULL,
                queries INTEGER NOT NULL,
                slow_queries INTEGER NOT NULL,
                connections INTEGER NOT NULL,
                bytes_received INTEGER NOT NULL,
                bytes_sent INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_metrics_conn_time ON server_metrics_history(connection_id, timestamp);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn save_snapshot(
        &self,
        connection_id: &str,
        status: &ServerStatus,
    ) -> Result<(), String> {
        sqlx::query(
            r#"
            INSERT INTO server_metrics_history (
                connection_id, timestamp, uptime, threads_connected, threads_running,
                queries, slow_queries, connections, bytes_received, bytes_sent
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(connection_id)
        .bind(Utc::now())
        .bind(status.uptime)
        .bind(status.threads_connected)
        .bind(status.threads_running)
        .bind(status.queries)
        .bind(status.slow_queries)
        .bind(status.connections)
        .bind(status.bytes_received)
        .bind(status.bytes_sent)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn get_history(
        &self,
        connection_id: &str,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
    ) -> Result<Vec<HistoricalMetric>, String> {
        let rows = sqlx::query_as::<_, HistoricalMetric>(
            r#"
            SELECT timestamp, uptime, threads_connected, threads_running,
                   queries, slow_queries, connections, bytes_received, bytes_sent
            FROM server_metrics_history
            WHERE connection_id = ? AND timestamp BETWEEN ? AND ?
            ORDER BY timestamp ASC
            "#,
        )
        .bind(connection_id)
        .bind(start_time)
        .bind(end_time)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(rows)
    }
}

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct HistoricalMetric {
    pub timestamp: DateTime<Utc>,
    pub uptime: i64,
    pub threads_connected: i64,
    pub threads_running: i64,
    pub queries: i64,
    pub slow_queries: i64,
    pub connections: i64,
    pub bytes_received: i64,
    pub bytes_sent: i64,
}
