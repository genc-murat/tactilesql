mod scoring;
mod mysql;
mod mssql;
mod postgres;
mod clickhouse;
mod recommendations;
mod persistence;

use crate::db_types::{
    AppState, DatabaseType, DatabaseHealthReport, HealthRecommendation,
    ScoreHistoryPoint, ApplyRecommendationResult, ConnectionConfig,
};
use tauri::State;
use serde::{Deserialize, Serialize};
use chrono::Utc;
use sqlx::{MySql, Pool};
use deadpool_tiberius::Pool as MssqlPool;
use sqlx::Postgres;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CategoryScoreJson {
    pub id: String,
    pub score: i32,
}

#[tauri::command]
pub async fn get_database_health_report(
    app_state: State<'_, AppState>,
) -> Result<DatabaseHealthReport, String> {
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };

    match db_type {
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            
            let connection_id = get_connection_id(&app_state).await;
            generate_mysql_health_report(pool, &app_state, &connection_id).await
        }
        DatabaseType::PostgreSQL => {
            let guard = app_state.postgres_pool.lock().await;
            let pool = guard.as_ref().ok_or("No PostgreSQL connection established")?;
            
            let connection_id = get_connection_id(&app_state).await;
            generate_postgres_health_report(pool, &app_state, &connection_id).await
        }
        DatabaseType::MSSQL => {
            let guard = app_state.mssql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MSSQL connection established")?;
            
            let connection_id = get_connection_id(&app_state).await;
            generate_mssql_health_report(pool, &app_state, &connection_id).await
        }
        DatabaseType::ClickHouse => {
            let guard = app_state.clickhouse_config.lock().await;
            let config = guard.as_ref().ok_or("No ClickHouse connection established")?;
            
            let connection_id = get_connection_id(&app_state).await;
            generate_clickhouse_health_report(config, &app_state, &connection_id).await
        }
        DatabaseType::Disconnected => Err("No database connection established".to_string()),
    }
}

async fn generate_mysql_health_report(
    pool: &Pool<MySql>,
    app_state: &AppState,
    connection_id: &str,
) -> Result<DatabaseHealthReport, String> {
    let config = mysql::MySqlHealthConfig::default();
    let categories = mysql::collect_mysql_health_metrics(pool, &config).await?;
    
    let overall_score = scoring::calculate_overall_score(&categories);
    let grade = scoring::score_to_grade(overall_score);
    let (critical_issues, warnings) = scoring::count_issues(&categories);
    
    let previous_scores = get_previous_scores(app_state, connection_id, 30).await;
    let trend = if !previous_scores.is_empty() {
        scoring::determine_trend(overall_score, &previous_scores.iter().map(|s| s.score).collect::<Vec<_>>())
    } else {
        "stable".to_string()
    };
    
    let category_scores_json = serde_json::to_string(
        &categories.iter().map(|c| CategoryScoreJson {
            id: c.id.clone(),
            score: c.score,
        }).collect::<Vec<_>>()
    ).unwrap_or_else(|_| "[]".to_string());
    
    if let Some(pool) = app_state.local_db_pool.lock().await.as_ref() {
        let _ = persistence::save_health_score(
            pool,
            connection_id,
            overall_score,
            &grade,
            &category_scores_json,
            critical_issues,
            warnings,
        ).await;
    }
    
    Ok(DatabaseHealthReport {
        overall_score,
        grade,
        trend,
        categories,
        critical_issues,
        warnings,
        last_updated: Utc::now().to_rfc3339(),
        previous_scores,
    })
}

async fn generate_mssql_health_report(
    pool: &MssqlPool,
    app_state: &AppState,
    connection_id: &str,
) -> Result<DatabaseHealthReport, String> {
    let config = mssql::MssqlHealthConfig::default();
    let categories = mssql::collect_mssql_health_metrics(pool, &config).await?;
    
    let overall_score = scoring::calculate_overall_score(&categories);
    let grade = scoring::score_to_grade(overall_score);
    let (critical_issues, warnings) = scoring::count_issues(&categories);
    
    let previous_scores = get_previous_scores(app_state, connection_id, 30).await;
    let trend = if !previous_scores.is_empty() {
        scoring::determine_trend(overall_score, &previous_scores.iter().map(|s| s.score).collect::<Vec<_>>())
    } else {
        "stable".to_string()
    };
    
    let category_scores_json = serde_json::to_string(
        &categories.iter().map(|c| CategoryScoreJson {
            id: c.id.clone(),
            score: c.score,
        }).collect::<Vec<_>>()
    ).unwrap_or_else(|_| "[]".to_string());
    
    if let Some(sqlite_pool) = app_state.local_db_pool.lock().await.as_ref() {
        let _ = persistence::save_health_score(
            sqlite_pool,
            connection_id,
            overall_score,
            &grade,
            &category_scores_json,
            critical_issues,
            warnings,
        ).await;
    }
    
    Ok(DatabaseHealthReport {
        overall_score,
        grade,
        trend,
        categories,
        critical_issues,
        warnings,
        last_updated: Utc::now().to_rfc3339(),
        previous_scores,
    })
}

async fn generate_postgres_health_report(
    pool: &Pool<Postgres>,
    app_state: &AppState,
    connection_id: &str,
) -> Result<DatabaseHealthReport, String> {
    let config = postgres::PostgresHealthConfig::default();
    let categories = postgres::collect_postgres_health_metrics(pool, &config).await?;
    
    let overall_score = scoring::calculate_overall_score(&categories);
    let grade = scoring::score_to_grade(overall_score);
    let (critical_issues, warnings) = scoring::count_issues(&categories);
    
    let previous_scores = get_previous_scores(app_state, connection_id, 30).await;
    let trend = if !previous_scores.is_empty() {
        scoring::determine_trend(overall_score, &previous_scores.iter().map(|s| s.score).collect::<Vec<_>>())
    } else {
        "stable".to_string()
    };
    
    let category_scores_json = serde_json::to_string(
        &categories.iter().map(|c| CategoryScoreJson {
            id: c.id.clone(),
            score: c.score,
        }).collect::<Vec<_>>()
    ).unwrap_or_else(|_| "[]".to_string());
    
    if let Some(sqlite_pool) = app_state.local_db_pool.lock().await.as_ref() {
        let _ = persistence::save_health_score(
            sqlite_pool,
            connection_id,
            overall_score,
            &grade,
            &category_scores_json,
            critical_issues,
            warnings,
        ).await;
    }
    
    Ok(DatabaseHealthReport {
        overall_score,
        grade,
        trend,
        categories,
        critical_issues,
        warnings,
        last_updated: Utc::now().to_rfc3339(),
        previous_scores,
    })
}

async fn generate_clickhouse_health_report(
    config: &ConnectionConfig,
    app_state: &AppState,
    connection_id: &str,
) -> Result<DatabaseHealthReport, String> {
    let health_config = clickhouse::ClickhouseHealthConfig::default();
    let categories = clickhouse::collect_clickhouse_health_metrics(config, &health_config).await?;
    
    let overall_score = scoring::calculate_overall_score(&categories);
    let grade = scoring::score_to_grade(overall_score);
    let (critical_issues, warnings) = scoring::count_issues(&categories);
    
    let previous_scores = get_previous_scores(app_state, connection_id, 30).await;
    let trend = if !previous_scores.is_empty() {
        scoring::determine_trend(overall_score, &previous_scores.iter().map(|s| s.score).collect::<Vec<_>>())
    } else {
        "stable".to_string()
    };
    
    let category_scores_json = serde_json::to_string(
        &categories.iter().map(|c| CategoryScoreJson {
            id: c.id.clone(),
            score: c.score,
        }).collect::<Vec<_>>()
    ).unwrap_or_else(|_| "[]".to_string());
    
    if let Some(sqlite_pool) = app_state.local_db_pool.lock().await.as_ref() {
        let _ = persistence::save_health_score(
            sqlite_pool,
            connection_id,
            overall_score,
            &grade,
            &category_scores_json,
            critical_issues,
            warnings,
        ).await;
    }
    
    Ok(DatabaseHealthReport {
        overall_score,
        grade,
        trend,
        categories,
        critical_issues,
        warnings,
        last_updated: Utc::now().to_rfc3339(),
        previous_scores,
    })
}

async fn get_previous_scores(app_state: &AppState, connection_id: &str, days: i32) -> Vec<ScoreHistoryPoint> {
    if let Some(pool) = app_state.local_db_pool.lock().await.as_ref() {
        match persistence::get_health_score_history(pool, connection_id, days).await {
            Ok(history) => history.records,
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    }
}

async fn get_connection_id(app_state: &AppState) -> String {
    let db_type = app_state.active_db_type.lock().await.clone();
    format!("{:?}", db_type)
}

#[tauri::command]
pub async fn get_health_recommendations(
    app_state: State<'_, AppState>,
    category: Option<String>,
    severity: Option<String>,
) -> Result<Vec<HealthRecommendation>, String> {
    let report = get_database_health_report(app_state).await?;
    
    let mut recommendations = recommendations::generate_recommendations(&report.categories);
    
    if let Some(cat) = category {
        recommendations.retain(|r| r.category == cat);
    }
    
    if let Some(sev) = severity {
        recommendations.retain(|r| r.severity == sev);
    }
    
    Ok(recommendations)
}

#[tauri::command]
pub async fn apply_recommendation(
    app_state: State<'_, AppState>,
    recommendation_id: String,
) -> Result<ApplyRecommendationResult, String> {
    let recommendations = get_health_recommendations(app_state.clone(), None, None).await?;
    
    let recommendation = recommendations
        .iter()
        .find(|r| r.id == recommendation_id)
        .ok_or_else(|| format!("Recommendation '{}' not found", recommendation_id))?;
    
    if recommendation.action_sql.is_none() {
        return Ok(ApplyRecommendationResult {
            success: false,
            message: "This recommendation requires manual action. No automatic SQL available.".to_string(),
            updated_score: None,
        });
    }
    
    let db_type = {
        let guard = app_state.active_db_type.lock().await;
        guard.clone()
    };
    
    match db_type {
        DatabaseType::MySQL => {
            let guard = app_state.mysql_pool.lock().await;
            let pool = guard.as_ref().ok_or("No MySQL connection established")?;
            
            let sql = recommendation.action_sql.as_ref().unwrap();
            
            let result = sqlx::query(sql)
                .execute(pool)
                .await;
            
            match result {
                Ok(_) => {
                    let updated_report = generate_mysql_health_report(
                        pool,
                        &app_state,
                        &get_connection_id(&app_state).await,
                    ).await?;
                    
                    Ok(ApplyRecommendationResult {
                        success: true,
                        message: format!("Successfully applied: {}", recommendation.title),
                        updated_score: Some(updated_report.overall_score),
                    })
                }
                Err(e) => Ok(ApplyRecommendationResult {
                    success: false,
                    message: format!("Failed to apply recommendation: {}", e),
                    updated_score: None,
                }),
            }
        }
        _ => Ok(ApplyRecommendationResult {
            success: false,
            message: "Database type not supported for automatic recommendations".to_string(),
            updated_score: None,
        }),
    }
}

#[tauri::command]
pub async fn get_health_score_history(
    app_state: State<'_, AppState>,
    days: i32,
) -> Result<Vec<ScoreHistoryPoint>, String> {
    let connection_id = get_connection_id(&app_state).await;
    
    if let Some(pool) = app_state.local_db_pool.lock().await.as_ref() {
        persistence::get_health_score_history(pool, &connection_id, days)
            .await
            .map(|h| h.records)
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn refresh_health_score(
    app_state: State<'_, AppState>,
) -> Result<DatabaseHealthReport, String> {
    get_database_health_report(app_state).await
}

#[tauri::command]
pub async fn get_quick_fix_recommendations(
    app_state: State<'_, AppState>,
) -> Result<Vec<HealthRecommendation>, String> {
    let report = get_database_health_report(app_state).await?;
    Ok(recommendations::get_quick_fixes(&report.categories))
}

#[allow(dead_code)]
pub async fn init_health_score_storage(app_state: &AppState) -> Result<(), String> {
    if let Some(pool) = app_state.local_db_pool.lock().await.as_ref() {
        persistence::init_health_score_table(pool).await?;
    }
    Ok(())
}
