use crate::schema_tracker::models::SchemaDiff;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Story {
    pub title: String,
    pub sections: Vec<StorySection>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StorySection {
    pub title: String,
    pub content: String,
    pub icon: String,
    pub changes: Vec<String>,
    pub severity: u8, // 0=None, 1=Info, 2=Warning, 3=Critical
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QuerySummary {
    pub total_queries: usize,
    pub total_rows_affected: u64,
    pub slow_queries_count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AnomalySummary {
    pub total_anomalies: usize,
    pub critical_count: usize,
}

pub fn generate_story(
    diff: &SchemaDiff,
    queries: Option<&[crate::awareness::profiler::QueryExecution]>,
    anomalies: Option<&[crate::awareness::anomaly::Anomaly]>,
) -> Story {
    let mut sections = Vec::new();

    // 1. New Tables
    if !diff.new_tables.is_empty() {
        let names: Vec<String> = diff.new_tables.iter().map(|t| t.name.clone()).collect();
        sections.push(StorySection {
            title: format!("{} New Tables Created", diff.new_tables.len()),
            content: format!("New tables were added to the schema: {}.", names.join(", ")),
            icon: "add_box".to_string(),
            changes: names,
            severity: 1,
        });
    }

    // 2. Dropped Tables
    if !diff.dropped_tables.is_empty() {
        let names: Vec<String> = diff.dropped_tables.iter().map(|t| t.name.clone()).collect();
        sections.push(StorySection {
            title: format!("{} Tables Dropped", diff.dropped_tables.len()),
            content: format!("Tables were removed from the schema: {}.", names.join(", ")),
            icon: "delete".to_string(),
            changes: names,
            severity: 2,
        });
    }

    // 3. Modified Tables
    for table_diff in &diff.modified_tables {
        let mut changes_desc = Vec::new();
        let mut detailed_changes = Vec::new();

        if !table_diff.new_columns.is_empty() {
            changes_desc.push(format!("added {} columns", table_diff.new_columns.len()));
            for col in &table_diff.new_columns {
                detailed_changes.push(format!("Added column '{}' ({})", col.name, col.column_type));
            }
        }
        if !table_diff.dropped_columns.is_empty() {
            changes_desc.push(format!(
                "removed {} columns",
                table_diff.dropped_columns.len()
            ));
            for col in &table_diff.dropped_columns {
                detailed_changes.push(format!("Dropped column '{}'", col.name));
            }
        }

        // Row Counts & Spikes
        if let Some(change) = table_diff.row_count_change {
            if change != 0 {
                let direction = if change > 0 { "grew by" } else { "shrank by" };
                changes_desc.push(format!("{} {} rows", direction, change.abs()));
                detailed_changes.push(format!("Rows: {:+} ({})", change, direction));

                // Spike Detection (absolute threshold heuristic)
                if change < -1000 {
                    detailed_changes.push("⚠️ SIGNIFICANT DATA LOSS DETECTED".to_string());
                }
            }
        }

        if !changes_desc.is_empty() {
            let mut severity = 1;
            if !table_diff.dropped_columns.is_empty() {
                severity = 2;
            }
            if table_diff.row_count_change.unwrap_or(0) < -1000 {
                severity = 3;
            }

            sections.push(StorySection {
                title: format!("Updates to '{}'", table_diff.table_name),
                content: format!(
                    "The table experienced the following changes: {}.",
                    changes_desc.join(", ")
                ),
                icon: "edit".to_string(),
                changes: detailed_changes,
                severity,
            });
        }
    }

    // 4. Awareness: Queries
    if let Some(q_list) = queries {
        if !q_list.is_empty() {
            let total_rows: u64 = q_list.iter().map(|e| e.resources.rows_affected).sum();
            let avg_time: f64 = q_list
                .iter()
                .map(|e| e.resources.execution_time_ms)
                .sum::<f64>()
                / q_list.len() as f64;

            sections.push(StorySection {
                title: "Query Activity".to_string(),
                content: format!(
                    "During this interval, {} queries were executed, affecting {} rows in total. Average execution time was {:.2}ms.",
                    q_list.len(), total_rows, avg_time
                ),
                icon: "monitoring".to_string(),
                changes: vec![
                    format!("Total Queries: {}", q_list.len()),
                    format!("Rows Affected: {}", total_rows),
                ],
                severity: 0,
            });
        }
    }

    // 5. Awareness: Anomalies
    if let Some(a_list) = anomalies {
        if !a_list.is_empty() {
            let criticals = a_list
                .iter()
                .filter(|a| matches!(a.severity, crate::awareness::anomaly::Severity::Critical))
                .count();

            sections.push(StorySection {
                title: format!("{} Anomalies Detected", a_list.len()),
                content: format!(
                    "Our anomaly engine flagged {} unusual events. {} of these were marked as critical performance regressions.",
                    a_list.len(), criticals
                ),
                icon: "warning".to_string(),
                changes: a_list.iter().take(5).map(|a| format!("[{}] {}", a.severity.clone() as u8, a.query)).collect(),
                severity: if criticals > 0 { 3 } else { 2 },
            });
        }
    }

    if sections.is_empty() {
        sections.push(StorySection {
            title: "No Significant Changes".to_string(),
            content: "The database schema and data volume remained stable during this period."
                .to_string(),
            icon: "check_circle".to_string(),
            changes: vec![],
            severity: 0,
        });
    }

    Story {
        title: "Database Evolution Report".to_string(),
        sections,
    }
}

#[cfg(test)]
mod tests;
