use sqlx::{Pool, Sqlite};
use crate::db_types::{ServerStatus};
use chrono::{DateTime, Utc};
use serde::{Serialize, Deserialize};

pub struct MonitorStore {
    pool: Pool<Sqlite>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct MonitorAlert {
    pub id: Option<i64>,
    pub connection_id: String,
    pub metric_name: String, // e.g., "threads_running", "qps", "slow_queries"
    pub threshold: f64,
    pub operator: String, // ">", "<", ">=", "<="
    pub is_enabled: bool,
    pub cooldown_secs: i64,
    pub last_triggered: Option<DateTime<Utc>>,
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

            CREATE TABLE IF NOT EXISTS monitoring_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                metric_name TEXT NOT NULL,
                threshold REAL NOT NULL,
                operator TEXT NOT NULL,
                is_enabled BOOLEAN NOT NULL DEFAULT 1,
                cooldown_secs INTEGER NOT NULL DEFAULT 300,
                last_triggered DATETIME
            );
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

    // --- Alert Management ---

    pub async fn get_alerts(&self, connection_id: &str) -> Result<Vec<MonitorAlert>, String> {
        let rows = sqlx::query_as::<_, MonitorAlert>(
            "SELECT * FROM monitoring_alerts WHERE connection_id = ?"
        )
        .bind(connection_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub async fn save_alert(&self, alert: &MonitorAlert) -> Result<i64, String> {
        let id = if let Some(id) = alert.id {
            sqlx::query(
                r#"
                UPDATE monitoring_alerts 
                SET metric_name = ?, threshold = ?, operator = ?, is_enabled = ?, cooldown_secs = ?
                WHERE id = ?
                "#,
            )
            .bind(&alert.metric_name)
            .bind(alert.threshold)
            .bind(&alert.operator)
            .bind(alert.is_enabled)
            .bind(alert.cooldown_secs)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
            id
        } else {
            let res = sqlx::query(
                r#"
                INSERT INTO monitoring_alerts (connection_id, metric_name, threshold, operator, is_enabled, cooldown_secs)
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&alert.connection_id)
            .bind(&alert.metric_name)
            .bind(alert.threshold)
            .bind(&alert.operator)
            .bind(alert.is_enabled)
            .bind(alert.cooldown_secs)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
            res.last_insert_rowid()
        };
        Ok(id)
    }

    pub async fn delete_alert(&self, id: i64) -> Result<(), String> {
        sqlx::query("DELETE FROM monitoring_alerts WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn mark_alert_triggered(&self, id: i64) -> Result<(), String> {
        sqlx::query("UPDATE monitoring_alerts SET last_triggered = ? WHERE id = ?")
            .bind(Utc::now())
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
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
