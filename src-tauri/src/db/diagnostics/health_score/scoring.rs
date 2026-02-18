use crate::db_types::{HealthCategory, HealthMetricDetail};

pub fn calculate_metric_score(
    value: f64,
    warning_threshold: f64,
    critical_threshold: f64,
    inverse: bool,
) -> i32 {
    if inverse {
        if value >= critical_threshold {
            return 0;
        }
        if value >= warning_threshold {
            let ratio = (critical_threshold - value) / (critical_threshold - warning_threshold);
            return (ratio * 50.0).round() as i32;
        }
        let ratio = (warning_threshold - value) / warning_threshold;
        return (50.0 + ratio * 50.0).min(100.0) as i32;
    } else {
        if value <= critical_threshold {
            return 0;
        }
        if value <= warning_threshold {
            let ratio = (value - critical_threshold) / (warning_threshold - critical_threshold);
            return (ratio * 50.0 + 50.0).round() as i32;
        }
        100
    }
}

pub fn get_status(value: f64, warning: f64, critical: f64, inverse: bool) -> String {
    if inverse {
        if value >= critical {
            return "critical".to_string();
        }
        if value >= warning {
            return "warning".to_string();
        }
        return "healthy".to_string();
    } else {
        if value <= critical {
            return "critical".to_string();
        }
        if value <= warning {
            return "warning".to_string();
        }
        return "healthy".to_string();
    }
}

pub fn calculate_category_score(metrics: &[HealthMetricDetail]) -> i32 {
    if metrics.is_empty() {
        return 100;
    }

    let total_weight: f32 = metrics.iter().map(|m| m.weight).sum();
    if total_weight <= 0.0 {
        let sum: i32 = metrics
            .iter()
            .map(|m| {
                calculate_metric_score(
                    m.raw_value,
                    m.threshold_warning,
                    m.threshold_critical,
                    is_inverse_metric(&m.id),
                )
            })
            .sum();
        return (sum as f64 / metrics.len() as f64).round() as i32;
    }

    let weighted_sum: f64 = metrics
        .iter()
        .map(|m| {
            let score = calculate_metric_score(
                m.raw_value,
                m.threshold_warning,
                m.threshold_critical,
                is_inverse_metric(&m.id),
            ) as f64;
            score * m.weight as f64
        })
        .sum();

    (weighted_sum / total_weight as f64).round() as i32
}

pub fn calculate_overall_score(categories: &[HealthCategory]) -> i32 {
    if categories.is_empty() {
        return 100;
    }

    let total_weight: f32 = categories.iter().map(|c| c.weight).sum();
    if total_weight <= 0.0 {
        let sum: i32 = categories.iter().map(|c| c.score).sum();
        return (sum as f64 / categories.len() as f64).round() as i32;
    }

    let weighted_sum: f64 = categories
        .iter()
        .map(|c| c.score as f64 * c.weight as f64)
        .sum();

    (weighted_sum / total_weight as f64).round() as i32
}

pub fn score_to_grade(score: i32) -> String {
    match score {
        95..=100 => "A+".to_string(),
        90..=94 => "A".to_string(),
        85..=89 => "B+".to_string(),
        80..=84 => "B".to_string(),
        70..=79 => "C".to_string(),
        60..=69 => "D".to_string(),
        _ => "F".to_string(),
    }
}

pub fn determine_trend(current: i32, previous_scores: &[i32]) -> String {
    if previous_scores.is_empty() {
        return "stable".to_string();
    }

    let avg_previous: i32 =
        (previous_scores.iter().sum::<i32>() as f64 / previous_scores.len() as f64).round() as i32;
    let diff = current - avg_previous;

    if diff > 5 {
        "improving".to_string()
    } else if diff < -5 {
        "declining".to_string()
    } else {
        "stable".to_string()
    }
}

fn is_inverse_metric(metric_id: &str) -> bool {
    matches!(
        metric_id,
        "perf_slow_queries"
            | "perf_full_scan"
            | "perf_tmp_tables"
            | "conn_usage"
            | "conn_errors"
            | "conn_idle"
            | "conn_max_used"
            | "stor_disk_usage"
            | "stor_bloat"
            | "stor_fragmented"
            | "stor_growth"
            | "maint_unused_idx"
            | "maint_dupe_idx"
            | "maint_tables_no_pk"
            | "sec_empty_pass"
            | "sec_root_remote"
            | "sec_all_priv"
    )
}

pub fn count_issues(categories: &[HealthCategory]) -> (i32, i32) {
    let mut critical = 0;
    let mut warnings = 0;

    for category in categories {
        for metric in &category.metrics {
            match metric.status.as_str() {
                "critical" => critical += 1,
                "warning" => warnings += 1,
                _ => {}
            }
        }
    }

    (critical, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_metric_score_inverse() {
        assert_eq!(calculate_metric_score(5.0, 10.0, 20.0, true), 100);
        assert_eq!(calculate_metric_score(15.0, 10.0, 20.0, true), 50);
        assert_eq!(calculate_metric_score(25.0, 10.0, 20.0, true), 0);
    }

    #[test]
    fn test_calculate_metric_score_normal() {
        assert_eq!(calculate_metric_score(95.0, 90.0, 80.0, false), 100);
        assert_eq!(calculate_metric_score(85.0, 90.0, 80.0, false), 50);
        assert_eq!(calculate_metric_score(75.0, 90.0, 80.0, false), 0);
    }

    #[test]
    fn test_score_to_grade() {
        assert_eq!(score_to_grade(97), "A+");
        assert_eq!(score_to_grade(92), "A");
        assert_eq!(score_to_grade(87), "B+");
        assert_eq!(score_to_grade(82), "B");
        assert_eq!(score_to_grade(75), "C");
        assert_eq!(score_to_grade(65), "D");
        assert_eq!(score_to_grade(55), "F");
    }
}
