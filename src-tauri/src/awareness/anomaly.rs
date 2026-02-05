use crate::awareness::profiler::{BaselineProfile, QueryExecution};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Severity {
    Info = 1,
    Warning = 2,
    Critical = 3,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyConfig {
    pub anomaly_threshold_pct: f64,       // e.g. 50.0 for 50% deviation
    pub min_executions_for_baseline: u64, // e.g. 5
}

impl Default for AnomalyConfig {
    fn default() -> Self {
        Self {
            anomaly_threshold_pct: 50.0,
            min_executions_for_baseline: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Anomaly {
    pub query_hash: String,
    pub query: String, // Normalized query pattern
    pub detected_at: DateTime<Utc>,
    pub severity: Severity,
    pub duration_ms: f64,
    pub baseline_duration_ms: f64,
    pub deviation_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyCause {
    pub cause_type: String, // "Missing Index", "Table Lock", "High Volume"
    pub probability: f64,
    pub description: String,
}

pub struct AnomalyDetector;

impl AnomalyDetector {
    pub fn detect(
        execution: &QueryExecution,
        baseline: &BaselineProfile,
        config: &AnomalyConfig,
    ) -> Option<Anomaly> {
        // 1. Check if we have enough history
        if baseline.total_executions < config.min_executions_for_baseline {
            return None;
        }

        // 2. Check deviation
        let avg = baseline.avg_duration_ms;
        let current = execution.resources.execution_time_ms;

        if avg <= 0.0 {
            return None;
        }

        let deviation = ((current - avg) / avg) * 100.0;

        // Only care about regressions (slower), not faster queries
        if deviation <= config.anomaly_threshold_pct {
            return None;
        }

        // 3. Determine severity
        let severity = if deviation > 200.0 {
            Severity::Critical
        } else if deviation > 100.0 {
            Severity::Warning
        } else {
            Severity::Info // or Warning depending on preference
        };

        Some(Anomaly {
            query_hash: execution.query_hash.clone(),
            query: baseline.query_pattern.clone(),
            detected_at: execution.timestamp,
            severity,
            duration_ms: current,
            baseline_duration_ms: avg,
            deviation_pct: deviation,
        })
    }

    pub fn analyze_cause(plan: &str) -> Option<AnomalyCause> {
        // Simple heuristic analysis of execution plan

        // Check for Full Table Scan (MySQL: type "ALL", Postgres: "Seq Scan")
        // Note: Simple string contains check might trigger false positives. logic should be robust enough.

        // Check for Full Table Scan
        // MySQL JSON: "access_type": "ALL"
        // MySQL Text: type: ALL (or just ALL in specific column, difficult to parse without structure)
        // PostgreSQL: "Seq Scan"
        let has_full_scan = plan.contains("Seq Scan") || plan.contains("\"access_type\": \"ALL\"");

        if has_full_scan {
            return Some(AnomalyCause {
                cause_type: "Missing Index".to_string(),
                probability: 0.8,
                description: "Execution plan indicates a full table scan. Consider adding an index on the filtered columns.".to_string(),
            });
        }

        None
    }
}
