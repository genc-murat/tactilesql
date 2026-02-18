use crate::db_types::{ScoreHistoryPoint, HealthScoreHistory};
use sqlx::{Sqlite, Pool};

const MAX_HISTORY_DAYS: i32 = 90;

#[allow(dead_code)]
pub async fn init_health_score_table(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS health_score_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            overall_score INTEGER NOT NULL,
            grade TEXT NOT NULL,
            category_scores TEXT NOT NULL,
            critical_issues INTEGER NOT NULL DEFAULT 0,
            warnings INTEGER NOT NULL DEFAULT 0,
            recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create health_score_history table: {}", e))?;
    
    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_health_connection_date 
        ON health_score_history(connection_id, recorded_at)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create index: {}", e))?;
    
    Ok(())
}

pub async fn save_health_score(
    pool: &Pool<Sqlite>,
    connection_id: &str,
    overall_score: i32,
    grade: &str,
    category_scores: &str,
    critical_issues: i32,
    warnings: i32,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO health_score_history 
        (connection_id, overall_score, grade, category_scores, critical_issues, warnings, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        "#,
    )
    .bind(connection_id)
    .bind(overall_score)
    .bind(grade)
    .bind(category_scores)
    .bind(critical_issues)
    .bind(warnings)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to save health score: {}", e))?;
    
    cleanup_old_records(pool, connection_id).await?;
    
    Ok(())
}

pub async fn get_health_score_history(
    pool: &Pool<Sqlite>,
    connection_id: &str,
    days: i32,
) -> Result<HealthScoreHistory, String> {
    let records: Vec<(i32, String, String)> = sqlx::query_as(
        r#"
        SELECT overall_score, grade, recorded_at
        FROM health_score_history
        WHERE connection_id = ?
        AND recorded_at >= datetime('now', ?)
        ORDER BY recorded_at DESC
        LIMIT ?
        "#,
    )
    .bind(connection_id)
    .bind(format!("-{} days", days))
    .bind(days)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch health score history: {}", e))?;
    
    let records: Vec<ScoreHistoryPoint> = records
        .into_iter()
        .map(|(score, grade, date)| ScoreHistoryPoint { score, grade, date })
        .collect();
    
    Ok(HealthScoreHistory {
        connection_id: connection_id.to_string(),
        records,
    })
}

#[allow(dead_code)]
pub async fn get_latest_scores(
    pool: &Pool<Sqlite>,
    connection_id: &str,
    count: i32,
) -> Result<Vec<i32>, String> {
    let scores: Vec<(i32,)> = sqlx::query_as(
        r#"
        SELECT overall_score
        FROM health_score_history
        WHERE connection_id = ?
        ORDER BY recorded_at DESC
        LIMIT ?
        "#,
    )
    .bind(connection_id)
    .bind(count)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch latest scores: {}", e))?;
    
    Ok(scores.into_iter().map(|(s,)| s).collect())
}

pub async fn cleanup_old_records(pool: &Pool<Sqlite>, connection_id: &str) -> Result<(), String> {
    sqlx::query(
        r#"
        DELETE FROM health_score_history
        WHERE connection_id = ?
        AND recorded_at < datetime('now', ?)
        "#,
    )
    .bind(connection_id)
    .bind(format!("-{} days", MAX_HISTORY_DAYS))
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to cleanup old records: {}", e))?;
    
    Ok(())
}

#[allow(dead_code)]
pub async fn get_trend_data(
    pool: &Pool<Sqlite>,
    connection_id: &str,
) -> Result<Option<TrendData>, String> {
    let records: Vec<(i32, String)> = sqlx::query_as(
        r#"
        SELECT overall_score, recorded_at
        FROM health_score_history
        WHERE connection_id = ?
        ORDER BY recorded_at DESC
        LIMIT 30
        "#,
    )
    .bind(connection_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch trend data: {}", e))?;
    
    if records.is_empty() {
        return Ok(None);
    }
    
    let scores: Vec<i32> = records.iter().map(|(s, _)| *s).collect();
    let current = scores.first().copied().unwrap_or(0);
    
    let avg_previous = if scores.len() > 1 {
        let sum: i32 = scores[1..].iter().sum();
        sum as f64 / (scores.len() - 1) as f64
    } else {
        current as f64
    };
    
    let trend = if current as f64 > avg_previous + 5.0 {
        "improving"
    } else if (current as f64) < avg_previous - 5.0 {
        "declining"
    } else {
        "stable"
    };
    
    Ok(Some(TrendData {
        current_score: current,
        average_score: avg_previous.round() as i32,
        trend: trend.to_string(),
        data_points: scores.len() as i32,
    }))
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct TrendData {
    pub current_score: i32,
    pub average_score: i32,
    pub trend: String,
    pub data_points: i32,
}

#[allow(dead_code)]
pub fn calculate_trend_direction(scores: &[i32]) -> String {
    if scores.len() < 2 {
        return "stable".to_string();
    }
    
    let recent: f64 = scores.iter().take(7).sum::<i32>() as f64 / (7.0_f64).min(scores.len() as f64);
    let older_start = 7.min(scores.len() - 1);
    let older: f64 = scores[older_start..].iter().sum::<i32>() as f64 / (scores.len() - older_start) as f64;
    
    let diff = recent - older;
    let diff_pct = if older > 0.0 { (diff / older) * 100.0 } else { 0.0 };
    
    if diff_pct > 5.0 {
        "improving".to_string()
    } else if diff_pct < -5.0 {
        "declining".to_string()
    } else {
        "stable".to_string()
    }
}
