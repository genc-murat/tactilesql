use crate::db_types::AppState;
use chrono;
use tauri::State;

// =====================================================
// AWARENESS & HISTORY
// =====================================================

#[tauri::command]
pub async fn compare_queries(
    app_state: State<'_, AppState>,
    query_a: String,
    query_b: String,
) -> Result<crate::awareness::comparator::ComparisonResult, String> {
    // 1. Syntax Diff
    let syntax_diff = crate::awareness::comparator::Comparator::compare_syntax(&query_a, &query_b);

    // 2. Metrics Comparison
    // Fetch profiles for both queries
    let store_guard = app_state.awareness_store.lock().await;
    let metrics = if let Some(store) = store_guard.as_ref() {
        let hash_a = crate::awareness::profiler::calculate_query_hash(
            &crate::awareness::profiler::normalize_query(&query_a),
        );
        let hash_b = crate::awareness::profiler::calculate_query_hash(
            &crate::awareness::profiler::normalize_query(&query_b),
        );

        let profile_a = store.get_baseline_profile(&hash_a).await?.unwrap_or(
            crate::awareness::profiler::BaselineProfile {
                query_hash: hash_a,
                query_pattern: "".to_string(),
                avg_duration_ms: 0.0,
                std_dev_duration_ms: 0.0,
                total_executions: 0,
                last_updated: chrono::Utc::now(),
            },
        );

        let profile_b = store.get_baseline_profile(&hash_b).await?.unwrap_or(
            crate::awareness::profiler::BaselineProfile {
                query_hash: hash_b,
                query_pattern: "".to_string(),
                avg_duration_ms: 0.0,
                std_dev_duration_ms: 0.0,
                total_executions: 0,
                last_updated: chrono::Utc::now(),
            },
        );

        crate::awareness::comparator::Comparator::compare_metrics(&profile_a, &profile_b)
    } else {
        Vec::new()
    };

    Ok(crate::awareness::comparator::ComparisonResult {
        syntax_diff,
        metrics,
    })
}

#[tauri::command]
pub async fn get_anomaly_history(
    app_state: State<'_, AppState>,
    limit: i64,
) -> Result<Vec<crate::awareness::anomaly::Anomaly>, String> {
    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_anomalies(limit).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_anomaly_cause(
    app_state: State<'_, AppState>,
    query_hash: String,
    detected_at: String,
) -> Result<Option<crate::awareness::anomaly::AnomalyCause>, String> {
    let ts = match chrono::DateTime::parse_from_rfc3339(&detected_at) {
        Ok(dt) => dt.with_timezone(&chrono::Utc),
        Err(_) => {
            let naive = chrono::NaiveDateTime::parse_from_str(&detected_at, "%Y-%m-%d %H:%M:%S%.f")
                .map_err(|e| format!("Invalid detected_at timestamp: {}", e))?;
            chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc)
        }
    };

    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_anomaly_cause(&query_hash, ts).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_query_history(
    app_state: State<'_, AppState>,
    limit: i64,
) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_query_history(limit).await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}

fn parse_history_range_ts(
    label: &str,
    value: Option<String>,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Ok(Some(parsed.with_timezone(&chrono::Utc)));
    }

    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S%.f") {
        return Ok(Some(
            chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc),
        ));
    }

    Err(format!(
        "Invalid {} timestamp. Expected RFC3339, got: {}",
        label, trimmed
    ))
}

#[tauri::command]
pub async fn get_query_history_range(
    app_state: State<'_, AppState>,
    start: Option<String>,
    end: Option<String>,
    limit: i64,
) -> Result<Vec<crate::awareness::profiler::QueryExecution>, String> {
    let parsed_start = parse_history_range_ts("start", start)?;
    let parsed_end = parse_history_range_ts("end", end)?;

    let guard = app_state.awareness_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store
            .get_query_history_range(parsed_start, parsed_end, limit)
            .await
    } else {
        Err("Awareness store not initialized".to_string())
    }
}
