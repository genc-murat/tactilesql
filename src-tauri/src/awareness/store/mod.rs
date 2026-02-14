use sqlx::{Pool, Row, Sqlite};

pub struct AwarenessStore {
    pool: Pool<Sqlite>,
}

impl AwarenessStore {
    pub async fn new(pool: Pool<Sqlite>) -> Result<Self, String> {
        let store = Self { pool };
        store.init_schema().await?;
        Ok(store)
    }

    async fn init_schema(&self) -> Result<(), String> {
        // Enable WAL for concurrency
        sqlx::query("PRAGMA journal_mode=WAL;")
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        // Baseline Profiles Table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS baseline_profiles (
                query_hash TEXT PRIMARY KEY,
                query_pattern TEXT NOT NULL,
                avg_duration_ms REAL NOT NULL,
                std_dev_duration_ms REAL,
                avg_cpu_usage REAL,
                avg_memory_usage REAL,
                total_executions INTEGER NOT NULL,
                last_updated DATETIME NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        // Execution History Table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS execution_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query_hash TEXT NOT NULL,
                exact_query TEXT,
                duration_ms REAL NOT NULL,
                timestamp DATETIME NOT NULL,
                rows_affected INTEGER,
                FOREIGN KEY(query_hash) REFERENCES baseline_profiles(query_hash)
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        // Anomaly Log Table
        // severity: 1=INFO, 2=WARNING, 3=CRITICAL
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS anomaly_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query_hash TEXT NOT NULL,
                detected_at DATETIME NOT NULL,
                severity INTEGER NOT NULL,
                cause TEXT,
                description TEXT,
                deviation_details TEXT, -- JSON payload of what was different
                status TEXT DEFAULT 'OPEN' -- OPEN, ACKNOWLEDGED, RESOLVED
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        // Awareness Config Table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS awareness_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let default_config =
            serde_json::to_string(&crate::awareness::anomaly::AnomalyConfig::default())
                .map_err(|e| e.to_string())?;
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO awareness_config (key, value, updated_at)
            VALUES (?, ?, ?)
            "#,
        )
        .bind("anomaly_config")
        .bind(default_config)
        .bind(chrono::Utc::now())
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn get_pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    pub async fn log_query_execution(
        &self,
        execution: &crate::awareness::profiler::QueryExecution,
    ) -> Result<Option<crate::awareness::anomaly::Anomaly>, String> {
        // 1. Get current baseline for anomaly detection (before update)
        let current_baseline = self.get_baseline_profile(&execution.query_hash).await?;

        // 2. Update/Create baseline profile (Ensures FK constraint for history)
        self.update_baseline_profile(execution).await?;

        // 3. Insert into execution_history
        sqlx::query(
            r#"
            INSERT INTO execution_history (query_hash, exact_query, duration_ms, timestamp, rows_affected)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(&execution.query_hash)
        .bind(&execution.exact_query)
        .bind(&execution.resources.execution_time_ms)
        .bind(execution.timestamp)
        .bind(execution.resources.rows_affected as i64)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to log execution: {}", e))?;

        // 4. Detect Anomaly (using the PRE-UPDATE baseline)
        let mut detected_anomaly = None;
        if let Some(ref baseline) = current_baseline {
            let config = self.get_anomaly_config().await?;
            if let Some(anomaly) =
                crate::awareness::anomaly::AnomalyDetector::detect(execution, baseline, &config)
            {
                if let Err(e) = self.log_anomaly(&anomaly).await {
                    log::error!("Failed to log anomaly: {}", e);
                } else {
                    detected_anomaly = Some(anomaly);
                }
            }
        }

        Ok(detected_anomaly)
    }

    async fn get_anomaly_config(&self) -> Result<crate::awareness::anomaly::AnomalyConfig, String> {
        let row = sqlx::query(
            r#"
            SELECT value
            FROM awareness_config
            WHERE key = ?
            "#,
        )
        .bind("anomaly_config")
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch anomaly config: {}", e))?;

        if let Some(row) = row {
            let value: String = row.try_get("value").unwrap_or_default();
            match serde_json::from_str::<crate::awareness::anomaly::AnomalyConfig>(&value) {
                Ok(config) => Ok(config),
                Err(e) => {
                    log::warn!("Invalid anomaly config JSON, using default: {}", e);
                    Ok(crate::awareness::anomaly::AnomalyConfig::default())
                }
            }
        } else {
            Ok(crate::awareness::anomaly::AnomalyConfig::default())
        }
    }

    pub async fn log_anomaly(
        &self,
        anomaly: &crate::awareness::anomaly::Anomaly,
    ) -> Result<(), String> {
        let severity_int = anomaly.severity.clone() as i32;
        let deviation_json = serde_json::json!({
            "duration": anomaly.duration_ms,
            "baseline": anomaly.baseline_duration_ms,
            "deviation_pct": anomaly.deviation_pct
        });

        sqlx::query(
            r#"
            INSERT INTO anomaly_log (query_hash, detected_at, severity, cause, description, deviation_details, status)
            VALUES (?, ?, ?, ?, ?, ?, 'OPEN')
            "#
        )
        .bind(&anomaly.query_hash)
        .bind(anomaly.detected_at)
        .bind(severity_int)
        .bind(Option::<String>::None)
        .bind(format!("Performance regression detected: {:.2}% slower than baseline", anomaly.deviation_pct))
        .bind(deviation_json.to_string())
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to insert anomaly: {}", e))?;

        Ok(())
    }

    pub async fn update_anomaly_cause(
        &self,
        query_hash: &str,
        timestamp: chrono::DateTime<chrono::Utc>,
        cause: &crate::awareness::anomaly::AnomalyCause,
    ) -> Result<(), String> {
        let cause_json = serde_json::to_string(cause).unwrap_or_default();

        sqlx::query(
            r#"
            UPDATE anomaly_log 
            SET cause = ?
            WHERE query_hash = ? AND detected_at = ?
            "#,
        )
        .bind(cause_json)
        .bind(query_hash)
        .bind(timestamp)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to update anomaly cause: {}", e))?;

        Ok(())
    }

    pub async fn get_anomaly_cause(
        &self,
        query_hash: &str,
        timestamp: chrono::DateTime<chrono::Utc>,
    ) -> Result<Option<crate::awareness::anomaly::AnomalyCause>, String> {
        let row = sqlx::query(
            r#"
            SELECT cause
            FROM anomaly_log
            WHERE query_hash = ? AND detected_at = ?
            LIMIT 1
            "#,
        )
        .bind(query_hash)
        .bind(timestamp)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch anomaly cause: {}", e))?;

        if let Some(row) = row {
            let cause_json: Option<String> = row.try_get("cause").ok();
            if let Some(cause_json) = cause_json {
                if cause_json.trim().is_empty() {
                    return Ok(None);
                }
                match serde_json::from_str::<crate::awareness::anomaly::AnomalyCause>(&cause_json) {
                    Ok(cause) => Ok(Some(cause)),
                    Err(e) => {
                        log::warn!("Invalid anomaly cause JSON, ignoring: {}", e);
                        Ok(None)
                    }
                }
            } else {
                Ok(None)
            }
        } else {
            Ok(None)
        }
    }

    async fn update_baseline_profile(
        &self,
        execution: &crate::awareness::profiler::QueryExecution,
    ) -> Result<(), String> {
        // Retrieve current baseline
        let current_baseline: Option<(f64, f64, i64)> = sqlx::query_as(
            r#"
            SELECT avg_duration_ms, std_dev_duration_ms, total_executions
            FROM baseline_profiles
            WHERE query_hash = ?
            "#,
        )
        .bind(&execution.query_hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch baseline: {}", e))?;

        let (new_avg, new_std_dev, new_total) = match current_baseline {
            Some((avg, std_dev, total)) => {
                let new_total = total + 1;
                let new_val = execution.resources.execution_time_ms;

                // Welford's online algorithm for standard deviation could be better,
                // but for simplicity/storage limitation we might use a simpler approximation or re-query history if needed.
                // However, fetching all history is expensive.
                // Let's use a simple running average.
                // new_avg = old_avg + (new_val - old_avg) / new_n
                let new_avg = avg + (new_val - avg) / (new_total as f64);

                // For std_dev online update:
                // M2_new = M2_old + (new_val - old_avg) * (new_val - new_avg)
                // std_dev = sqrt(M2 / n)
                // We'd need to store M2 (sum of squares of differences) to be accurate.
                // Or we can just approximation or assume 0 for now if we don't strictly need it yet.
                // Let's try to do it right if we can, but we didn't store M2.
                // Let's just stick to average for now to avoid complexity without schema change,
                // or just leave std_dev as is (0.0) until we need it.
                // Wait, I defined std_dev_duration_ms in schema.

                // Let's just update average and count for MVP.
                (new_avg, std_dev, new_total)
            }
            None => {
                // First execution
                (execution.resources.execution_time_ms, 0.0, 1)
            }
        };

        // Upsert
        let query_pattern = crate::awareness::profiler::normalize_query(&execution.exact_query);

        sqlx::query(
            r#"
            INSERT INTO baseline_profiles (
                query_hash, query_pattern, avg_duration_ms, std_dev_duration_ms, 
                avg_cpu_usage, avg_memory_usage, total_executions, last_updated
            )
            VALUES (?, ?, ?, ?, 0.0, 0.0, ?, ?)
            ON CONFLICT(query_hash) DO UPDATE SET
                avg_duration_ms = excluded.avg_duration_ms,
                total_executions = excluded.total_executions,
                last_updated = excluded.last_updated
            "#,
        )
        .bind(&execution.query_hash)
        .bind(query_pattern)
        .bind(new_avg)
        .bind(new_std_dev)
        .bind(new_total)
        .bind(execution.timestamp)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to update baseline: {}", e))?;

        Ok(())
    }

    pub async fn get_baseline_profile(
        &self,
        query_hash: &str,
    ) -> Result<Option<crate::awareness::profiler::BaselineProfile>, String> {
        let row = sqlx::query(
            r#"
            SELECT 
                query_hash, query_pattern, avg_duration_ms, std_dev_duration_ms, 
                total_executions, last_updated
            FROM baseline_profiles
            WHERE query_hash = ?
            "#,
        )
        .bind(query_hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch profile: {}", e))?;

        if let Some(row) = row {
            Ok(Some(crate::awareness::profiler::BaselineProfile {
                query_hash: row.try_get("query_hash").unwrap_or_default(),
                query_pattern: row.try_get("query_pattern").unwrap_or_default(),
                avg_duration_ms: row.try_get("avg_duration_ms").unwrap_or_default(),
                std_dev_duration_ms: row.try_get("std_dev_duration_ms").unwrap_or_default(),
                total_executions: row.try_get::<i64, _>("total_executions").unwrap_or(0) as u64,
                last_updated: row.try_get("last_updated").unwrap_or_default(),
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn get_anomalies(
        &self,
        limit: i64,
    ) -> Result<Vec<crate::awareness::anomaly::Anomaly>, String> {
        self.get_anomalies_range(None, None, limit).await
    }

    pub async fn get_anomalies_range(
        &self,
        start: Option<chrono::DateTime<chrono::Utc>>,
        end: Option<chrono::DateTime<chrono::Utc>>,
        limit: i64,
    ) -> Result<Vec<crate::awareness::anomaly::Anomaly>, String> {
        let mut query = "SELECT al.query_hash, al.detected_at, al.severity, al.deviation_details, bp.query_pattern FROM anomaly_log al LEFT JOIN baseline_profiles bp ON al.query_hash = bp.query_hash".to_string();
        let mut conditions = Vec::new();
        if start.is_some() {
            conditions.push("al.detected_at >= ?");
        }
        if end.is_some() {
            conditions.push("al.detected_at <= ?");
        }

        if !conditions.is_empty() {
            query.push_str(" WHERE ");
            query.push_str(&conditions.join(" AND "));
        }
        query.push_str(" ORDER BY al.detected_at DESC LIMIT ?");

        let mut sql = sqlx::query(&query);
        if let Some(s) = start {
            sql = sql.bind(s);
        }
        if let Some(e) = end {
            sql = sql.bind(e);
        }
        sql = sql.bind(limit);

        let rows = sql
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to fetch anomalies range: {}", e))?;

        let mut anomalies = Vec::new();
        for row in rows {
            let details_str: String = row.try_get("deviation_details").unwrap_or_default();
            let details: serde_json::Value =
                serde_json::from_str(&details_str).unwrap_or(serde_json::json!({
                    "duration": 0.0, "baseline": 0.0, "deviation_pct": 0.0
                }));

            let severity_int: i32 = row.try_get("severity").unwrap_or(1);
            let severity = match severity_int {
                2 => crate::awareness::anomaly::Severity::Warning,
                3 => crate::awareness::anomaly::Severity::Critical,
                _ => crate::awareness::anomaly::Severity::Info,
            };

            anomalies.push(crate::awareness::anomaly::Anomaly {
                query_hash: row.try_get("query_hash").unwrap_or_default(),
                query: row
                    .try_get("query_pattern")
                    .unwrap_or_else(|_| "Unknown Query".to_string()),
                detected_at: row.try_get("detected_at").unwrap_or_default(),
                severity,
                duration_ms: details["duration"].as_f64().unwrap_or(0.0),
                baseline_duration_ms: details["baseline"].as_f64().unwrap_or(0.0),
                deviation_pct: details["deviation_pct"].as_f64().unwrap_or(0.0),
            });
        }
        Ok(anomalies)
    }

    pub async fn get_query_history(
        &self,
        limit: i64,
    ) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
        self.get_query_history_range(None, None, limit).await
    }

    pub async fn get_query_history_range(
        &self,
        start: Option<chrono::DateTime<chrono::Utc>>,
        end: Option<chrono::DateTime<chrono::Utc>>,
        limit: i64,
    ) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
        let mut query = "SELECT query_hash, exact_query, duration_ms, timestamp, rows_affected FROM execution_history".to_string();
        let mut conditions = Vec::new();
        if start.is_some() {
            conditions.push("timestamp >= ?");
        }
        if end.is_some() {
            conditions.push("timestamp <= ?");
        }

        if !conditions.is_empty() {
            query.push_str(" WHERE ");
            query.push_str(&conditions.join(" AND "));
        }
        query.push_str(" ORDER BY timestamp DESC LIMIT ?");

        let mut sql = sqlx::query(&query);
        if let Some(s) = start {
            sql = sql.bind(s);
        }
        if let Some(e) = end {
            sql = sql.bind(e);
        }
        sql = sql.bind(limit);

        let rows = sql
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to fetch history range: {}", e))?;

        let mut executions = Vec::new();
        for row in rows {
            executions.push(crate::awareness::profiler::QueryExecution {
                query_hash: row.try_get("query_hash").unwrap_or_default(),
                exact_query: row.try_get("exact_query").unwrap_or_default(),
                timestamp: row.try_get("timestamp").unwrap_or_default(),
                resources: crate::awareness::profiler::ResourceUsage {
                    execution_time_ms: row.try_get("duration_ms").unwrap_or_default(),
                    rows_affected: row.try_get::<i64, _>("rows_affected").unwrap_or(0) as u64,
                },
            });
        }
        Ok(executions)
    }
}

#[cfg(test)]
mod tests;
