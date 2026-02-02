use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use crate::awareness::profiler::BaselineProfile;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonRequest {
    pub query_a: String,
    pub query_b: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffChange {
    pub tag: String, // "Delete", "Insert", "Equal"
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyntaxDiff {
    pub changes: Vec<DiffChange>,
    pub similarity_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricComparison {
    pub metric_name: String,
    pub value_a: f64,
    pub value_b: f64,
    pub pct_diff: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonResult {
    pub syntax_diff: SyntaxDiff,
    pub metrics: Vec<MetricComparison>,
    // Plan diff will be added later
}

pub struct Comparator;

impl Comparator {
    pub fn compare_syntax(query_a: &str, query_b: &str) -> SyntaxDiff {
        let diff = TextDiff::from_lines(query_a, query_b);
        let mut changes = Vec::new();

        for change in diff.iter_all_changes() {
            let tag = match change.tag() {
                ChangeTag::Delete => "Delete",
                ChangeTag::Insert => "Insert",
                ChangeTag::Equal => "Equal",
            };
            changes.push(DiffChange {
                tag: tag.to_string(),
                value: change.to_string(),
            });
        }

        let similarity_score = diff.ratio() as f64;

        SyntaxDiff {
            changes,
            similarity_score,
        }
    }

    pub fn compare_metrics(profile_a: &BaselineProfile, profile_b: &BaselineProfile) -> Vec<MetricComparison> {
        let mut metrics = Vec::new();

        // Duration
        let val_a = profile_a.avg_duration_ms;
        let val_b = profile_b.avg_duration_ms;
        let pct_diff = if val_a == 0.0 { 
            if val_b == 0.0 { 0.0 } else { 100.0 } 
        } else { 
            ((val_b - val_a) / val_a) * 100.0 
        };

        metrics.push(MetricComparison {
            metric_name: "Average Duration (ms)".to_string(),
            value_a: val_a,
            value_b: val_b,
            pct_diff,
        });

        // Add more metrics here (CPU, Memory, etc.)

        metrics
    }
}
