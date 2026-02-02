use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite, Row};
use log::{info, error};

pub struct AwarenessStore {
    pool: Pool<Sqlite>,
}

impl AwarenessStore {
    pub async fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("Failed to get app data directory");

        let awareness_dir = app_data_dir.join("awareness");
        if !awareness_dir.exists() {
            fs::create_dir_all(&awareness_dir).map_err(|e| e.to_string())?;
        }

        let db_path = awareness_dir.join("awareness.db");
        let db_url = format!("sqlite:{}", db_path.to_string_lossy());

        // Create file if not exists (sqlx requires it for sqlite)
        if !db_path.exists() {
            fs::File::create(&db_path).map_err(|e| e.to_string())?;
        }

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await
            .map_err(|e| format!("Failed to connect to awareness DB: {}", e))?;

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
            "#
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
            "#
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
            "#
        )
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
        // 1. Insert into execution_history
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

        // 2. Detect Anomaly
        let mut detected_anomaly = None;
        let current_baseline = self.get_baseline_profile(&execution.query_hash).await?;
        
        if let Some(ref baseline) = current_baseline {
            let config = crate::awareness::anomaly::AnomalyConfig::default(); // TODO: Load from stored config
            if let Some(anomaly) = crate::awareness::anomaly::AnomalyDetector::detect(execution, baseline, &config) {
                 if let Err(e) = self.log_anomaly(&anomaly).await {
                     log::error!("Failed to log anomaly: {}", e);
                 } else {
                     detected_anomaly = Some(anomaly);
                 }
            }
        }

        // 3. Update baseline profile
        self.update_baseline_profile(execution).await?;

        Ok(detected_anomaly)
    }

    pub async fn log_anomaly(&self, anomaly: &crate::awareness::anomaly::Anomaly) -> Result<(), String> {
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
        cause: &crate::awareness::anomaly::AnomalyCause
    ) -> Result<(), String> {
        let cause_json = serde_json::to_string(cause).unwrap_or_default();
        
        sqlx::query(
            r#"
            UPDATE anomaly_log 
            SET cause = ?
            WHERE query_hash = ? AND detected_at = ?
            "#
        )
        .bind(cause_json)
        .bind(query_hash)
        .bind(timestamp)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to update anomaly cause: {}", e))?;
        
        Ok(())
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
                let n = total as f64;
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

    pub async fn get_anomalies(&self, limit: i64) -> Result<Vec<crate::awareness::anomaly::Anomaly>, String> {
        // We need to reconstruct Anomaly struct from database columns
        // Note: anomaly_log table has slightly different structure than Anomaly struct
        // Anomaly struct: query_hash, detected_at, severity, duration_ms, baseline_duration_ms, deviation_pct
        // anomaly_log table: id, query_hash, detected_at, severity, cause, description, deviation_details, status
        
        let rows = sqlx::query(
            r#"
            SELECT query_hash, detected_at, severity, deviation_details
            FROM anomaly_log
            ORDER BY detected_at DESC
            LIMIT ?
            "#
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch anomalies: {}", e))?;

        let mut anomalies = Vec::new();
        for row in rows {
            let details_str: String = row.try_get("deviation_details").unwrap_or_default();
            let details: serde_json::Value = serde_json::from_str(&details_str).unwrap_or(serde_json::json!({
                "duration": 0.0,
                "baseline": 0.0,
                "deviation_pct": 0.0
            }));

            let severity_int: i32 = row.try_get("severity").unwrap_or(1);
            let severity = match severity_int {
                2 => crate::awareness::anomaly::Severity::Warning,
                3 => crate::awareness::anomaly::Severity::Critical,
                _ => crate::awareness::anomaly::Severity::Info,
            };

            anomalies.push(crate::awareness::anomaly::Anomaly {
                query_hash: row.try_get("query_hash").unwrap_or_default(),
                detected_at: row.try_get("detected_at").unwrap_or_default(),
                severity,
                duration_ms: details["duration"].as_f64().unwrap_or(0.0),
                baseline_duration_ms: details["baseline"].as_f64().unwrap_or(0.0),
                deviation_pct: details["deviation_pct"].as_f64().unwrap_or(0.0),
            });
        }
        
        Ok(anomalies)
    }

    pub async fn get_query_history(&self, limit: i64) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
        let rows = sqlx::query(
            r#"
            SELECT 
                query_hash, exact_query, duration_ms, timestamp, rows_affected
            FROM execution_history
            ORDER BY timestamp DESC
            LIMIT ?
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch history: {}", e))?;

        let mut executions = Vec::new();
        for row in rows {
            executions.push(crate::awareness::profiler::QueryExecution {
                query_hash: row.try_get("query_hash").unwrap_or_default(),
                exact_query: row.try_get("exact_query").unwrap_or_default(),
                timestamp: row.try_get("timestamp").unwrap_or_default(),
                resources: crate::awareness::profiler::ResourceUsage {
                    execution_time_ms: row.try_get("duration_ms").unwrap_or_default(),
                    rows_affected: row.try_get::<i64, _>("rows_affected").unwrap_or(0) as u64,
                }
            });
        }

        Ok(executions)
    }
}
