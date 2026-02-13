use crate::quality_analyzer::models::*;
use sqlx::{MySql, Pool, Postgres, Row};

pub async fn analyze_table_mysql(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
    connection_id: &str,
    sample_percent: Option<f64>,
) -> Result<TableQualityReport, String> {
    // 1. Get Row Count
    let count_query = format!("SELECT COUNT(*) FROM {}.{}", database, table);
    let total_row_count: i64 = sqlx::query_scalar(&count_query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to get row count: {}", e))?;

    if total_row_count == 0 {
        return Ok(TableQualityReport {
            id: None,
            connection_id: connection_id.to_string(),
            table_name: table.to_string(),
            timestamp: chrono::Utc::now(),
            overall_score: 100.0,
            row_count: 0,
            column_metrics: Vec::new(),
            issues: Vec::new(),
            schema_snapshot_id: None,
            schema_name: Some(database.to_string()),
        });
    }

    // 2. Get Columns
    let columns_query = format!(
        "SELECT CAST(COLUMN_NAME AS CHAR) as COLUMN_NAME, CAST(DATA_TYPE AS CHAR) as DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'",
        database, table
    );
    let columns: Vec<(String, String)> = sqlx::query_as(&columns_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch columns: {}", e))?;

    let mut column_metrics = Vec::new();
    let mut issues = Vec::new();

    // 3. Optimized Metrics Gathering (Single Query for NULLs, Distincts, Stats)
    let mut select_expressions = Vec::new();
    struct ColMeta {
        name: String,
        is_numeric: bool,
    }
    let mut cols_meta = Vec::new();

    // Sampling clause
    let sampling_where = if let Some(p) = sample_percent {
        format!("WHERE RAND() < {}", p / 100.0)
    } else {
        "".to_string()
    };

    select_expressions.push("COUNT(*)".to_string());

    for (col_name, data_type) in &columns {
        let is_numeric = ["int", "decimal", "float", "double", "numeric"]
            .iter()
            .any(|t| data_type.contains(t));
        
        cols_meta.push(ColMeta {
            name: col_name.clone(),
            is_numeric,
        });

        select_expressions.push(format!("SUM(CASE WHEN `{}` IS NULL THEN 1 ELSE 0 END)", col_name));
        select_expressions.push(format!("COUNT(DISTINCT `{}`)", col_name));

        if is_numeric {
            select_expressions.push(format!("MIN(`{}`)", col_name));
            select_expressions.push(format!("MAX(`{}`)", col_name));
            select_expressions.push(format!("AVG(`{}`)", col_name));
            select_expressions.push(format!("STDDEV(`{}`)", col_name));
        } else {
            select_expressions.push("NULL".to_string());
            select_expressions.push("NULL".to_string());
            select_expressions.push("NULL".to_string());
            select_expressions.push("NULL".to_string());
        }
    }

    let combined_query = format!(
        "SELECT {} FROM {}.{} {}",
        select_expressions.join(", "),
        database, table, sampling_where
    );

    let row = sqlx::query(&combined_query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to run optimized metrics query: {}", e))?;

    let sample_row_count: i64 = row.try_get(0).unwrap_or(0);
    let mut current_idx = 1;

    for meta in cols_meta {
        let null_count: i64 = row.try_get(current_idx).unwrap_or(0);
        let distinct_count: i64 = row.try_get(current_idx + 1).unwrap_or(0);
        
        let mut min_val = None;
        let mut max_val = None;
        let mut mean_val = None;
        let mut stddev_val = None;

        if meta.is_numeric {
            min_val = row.try_get::<Option<String>, _>(current_idx + 2).unwrap_or(None);
            max_val = row.try_get::<Option<String>, _>(current_idx + 3).unwrap_or(None);
            mean_val = row.try_get::<Option<f64>, _>(current_idx + 4).unwrap_or(None);
            stddev_val = row.try_get::<Option<f64>, _>(current_idx + 5).unwrap_or(None);
        }

        current_idx += 6;

        let null_pct = if sample_row_count > 0 {
            (null_count as f32 / sample_row_count as f32) * 100.0
        } else {
            0.0
        };
        let distinct_pct = if sample_row_count > 0 {
            (distinct_count as f32 / sample_row_count as f32) * 100.0
        } else {
            0.0
        };

        if null_pct > 50.0 {
            issues.push(DataQualityIssue {
                issue_type: IssueType::HighNullRate,
                severity: IssueSeverity::Warning,
                description: format!("Column '{}' has {:.1}% NULL values.", meta.name, null_pct),
                column_name: Some(meta.name.clone()),
                affected_row_count: Some(null_count as u64),
                drill_down_query: Some(format!("SELECT * FROM {}.{} WHERE `{}` IS NULL LIMIT 50", database, table, meta.name)),
            });
        }

        if let (Some(u), Some(s)) = (mean_val, stddev_val) {
            if s > 0.0 {
                let outlier_query = format!(
                    "SELECT COUNT(*) FROM {}.{} WHERE ABS(`{}` - {}) > 3 * {} {}",
                    database, table, meta.name, u, s,
                    if sampling_where.is_empty() { "".to_string() } else { format!("AND {}", sampling_where.replace("WHERE ", "")) }
                );
                if let Ok(count) = sqlx::query_scalar::<_, i64>(&outlier_query).fetch_one(pool).await {
                    if count > 0 {
                        issues.push(DataQualityIssue {
                            issue_type: IssueType::OutlierDetected,
                            severity: IssueSeverity::Info,
                            description: format!("Column '{}' has {} outliers (> 3 stddev).", meta.name, count),
                            column_name: Some(meta.name.clone()),
                            affected_row_count: Some(count as u64),
                            drill_down_query: Some(format!(
                                "SELECT * FROM {}.{} WHERE ABS(`{}` - {}) > 3 * {} LIMIT 50",
                                database, table, meta.name, u, s
                            )),
                        });
                    }
                }
            }
        }

        let top_values_query = format!(
            "SELECT CAST(`{}` AS CHAR) as val, COUNT(*) as cnt FROM {}.{} WHERE `{}` IS NOT NULL {} GROUP BY val ORDER BY cnt DESC LIMIT 5",
            meta.name, database, table, meta.name, sampling_where
        );
        let mut top_values = Vec::new();
        if let Ok(rows) = sqlx::query(&top_values_query).fetch_all(pool).await {
            for row in rows {
                let value: Option<String> = row.try_get(0).unwrap_or(None);
                let count: i64 = row.try_get(1).unwrap_or(0);
                if let Some(v) = value {
                    top_values.push(ValueCount { value: v, count: count as u64 });
                }
            }
        }

        let mut pattern_metrics = Vec::new();
        let patterns = [
            ("Email", r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"),
            ("Phone", r"^\+?[0-9]{10,15}$"),
            ("UUID", r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
            ("IP Address", r"^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$"),
        ];

        for (name, regex) in patterns {
            let pattern_query = format!(
                "SELECT COUNT(*) FROM {}.{} WHERE `{}` REGEXP '{}' {}",
                database, table, meta.name, regex, sampling_where
            );
            if let Ok(count) = sqlx::query_scalar::<_, i64>(&pattern_query).fetch_one(pool).await {
                if count > 0 {
                    pattern_metrics.push(PatternMetric {
                        pattern_name: name.to_string(),
                        count: count as u64,
                        percentage: (count as f32 / sample_row_count as f32) * 100.0,
                    });
                }
            }
        }

        column_metrics.push(ColumnQualityMetrics {
            column_name: meta.name,
            null_count: null_count as u64,
            null_percentage: null_pct,
            distinct_count: distinct_count as u64,
            distinct_percentage: distinct_pct,
            min_value: min_val,
            max_value: max_val,
            mean_value: mean_val,
            top_values: if top_values.is_empty() { None } else { Some(top_values) },
            pattern_metrics: if pattern_metrics.is_empty() { None } else { Some(pattern_metrics) },
        });
    }

    if !column_metrics.is_empty() && sample_percent.is_none() {
        let all_cols = column_metrics
            .iter()
            .map(|c| format!("`{}`", c.column_name))
            .collect::<Vec<_>>()
            .join(", ");
        let dup_query = format!(
            "SELECT SUM(cnt - 1) FROM (SELECT COUNT(*) as cnt FROM {}.{} GROUP BY {} HAVING COUNT(*) > 1) as t",
            database, table, all_cols
        );

        let dup_count: Option<f64> = sqlx::query_scalar(&dup_query)
            .fetch_one(pool)
            .await
            .unwrap_or(None);

        if let Some(dups) = dup_count {
            if dups > 0.0 {
                issues.push(DataQualityIssue {
                    issue_type: IssueType::DuplicateRows,
                    severity: IssueSeverity::Warning,
                    description: format!("Found {} exact duplicate rows.", dups),
                    column_name: None,
                    affected_row_count: Some(dups as u64),
                    drill_down_query: Some(format!(
                        "SELECT *, COUNT(*) as dup_cnt FROM {}.{} GROUP BY {} HAVING COUNT(*) > 1 LIMIT 50",
                        database, table, all_cols
                    )),
                });
            }
        }
    }

    let fk_query = format!(
        "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME 
         FROM information_schema.KEY_COLUMN_USAGE 
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' AND REFERENCED_TABLE_NAME IS NOT NULL",
        database, table
    );

    let fks: Vec<(String, String, String)> = sqlx::query_as(&fk_query)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    for (col, parent_tbl, parent_col) in fks {
        let orphan_query = format!(
            "SELECT COUNT(*) FROM {}.{} c LEFT JOIN {}.{} p ON c.`{}` = p.`{}` WHERE p.`{}` IS NULL AND c.`{}` IS NOT NULL",
            database, table, database, parent_tbl, col, parent_col, parent_col, col
        );

        let orphan_count: i64 = sqlx::query_scalar(&orphan_query)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

        if orphan_count > 0 {
            issues.push(DataQualityIssue {
                issue_type: IssueType::ReferentialIntegrityFailure,
                severity: IssueSeverity::Critical,
                description: format!(
                    "Found {} orphaned rows in column '{}' referencing {}.{}",
                    orphan_count, col, parent_tbl, parent_col
                ),
                column_name: Some(col.clone()),
                affected_row_count: Some(orphan_count as u64),
                drill_down_query: Some(format!(
                    "SELECT c.* FROM {}.{} c LEFT JOIN {}.{} p ON c.`{}` = p.`{}` WHERE p.`{}` IS NULL AND c.`{}` IS NOT NULL LIMIT 50",
                    database, table, database, parent_tbl, col, parent_col, parent_col, col
                )),
            });
        }
    }

    Ok(TableQualityReport {
        id: None,
        connection_id: connection_id.to_string(),
        table_name: table.to_string(),
        timestamp: chrono::Utc::now(),
        overall_score: calculate_score(&issues),
        row_count: total_row_count as u64,
        column_metrics,
        issues,
        schema_snapshot_id: None,
        schema_name: Some(database.to_string()),
    })
}

fn calculate_score(issues: &[DataQualityIssue]) -> f32 {
    let mut score: f32 = 100.0;
    for issue in issues {
        match issue.severity {
            IssueSeverity::Info => score -= 1.0,
            IssueSeverity::Warning => score -= 5.0,
            IssueSeverity::Critical => score -= 20.0,
        }
    }
    score.max(0.0)
}

pub async fn analyze_table_postgres(
    pool: &Pool<Postgres>,
    schema: &str,
    table: &str,
    connection_id: &str,
    sample_percent: Option<f64>,
) -> Result<TableQualityReport, String> {
    let count_query = format!("SELECT COUNT(*) FROM {}.{}", schema, table);
    let total_row_count: i64 = sqlx::query_scalar(&count_query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to get row count: {}", e))?;

    if total_row_count == 0 {
        return Ok(TableQualityReport {
            id: None,
            connection_id: connection_id.to_string(),
            table_name: table.to_string(),
            timestamp: chrono::Utc::now(),
            overall_score: 100.0,
            row_count: 0,
            column_metrics: Vec::new(),
            issues: Vec::new(),
            schema_snapshot_id: None,
            schema_name: Some(schema.to_string()),
        });
    }

    let columns_query = format!(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '{}' AND table_name = '{}'",
        schema, table
    );
    let columns: Vec<(String, String)> = sqlx::query_as(&columns_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch columns: {}", e))?;

    let mut column_metrics = Vec::new();
    let mut issues = Vec::new();

    let mut select_expressions = Vec::new();
    struct ColMeta {
        name: String,
        is_numeric: bool,
    }
    let mut cols_meta = Vec::new();

    let tablesample = if let Some(p) = sample_percent {
        format!("TABLESAMPLE SYSTEM ({})", p)
    } else {
        "".to_string()
    };

    select_expressions.push("COUNT(*)".to_string());

    for (col_name, data_type) in &columns {
        let is_numeric = ["int", "decimal", "float", "double", "numeric"]
            .iter()
            .any(|t| data_type.contains(t));
        
        cols_meta.push(ColMeta {
            name: col_name.clone(),
            is_numeric,
        });

        select_expressions.push(format!("SUM(CASE WHEN \"{}\" IS NULL THEN 1 ELSE 0 END)", col_name));
        select_expressions.push(format!("COUNT(DISTINCT \"{}\")", col_name));

        if is_numeric {
            select_expressions.push(format!("MIN(\"{}\")::text", col_name));
            select_expressions.push(format!("MAX(\"{}\")::text", col_name));
            select_expressions.push(format!("AVG(\"{}\")", col_name));
            select_expressions.push(format!("STDDEV(\"{}\")", col_name));
        } else {
            select_expressions.push("NULL".to_string());
            select_expressions.push("NULL".to_string());
            select_expressions.push("NULL".to_string());
            select_expressions.push("NULL".to_string());
        }
    }

    let combined_query = format!(
        "SELECT {} FROM {}.{} {}",
        select_expressions.join(", "),
        schema, table, tablesample
    );

    let row = sqlx::query(&combined_query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to run optimized metrics query: {}", e))?;

    let sample_row_count: i64 = row.try_get(0).unwrap_or(0);
    let mut current_idx = 1;

    for meta in cols_meta {
        let null_count: i64 = row.try_get(current_idx).unwrap_or(0);
        let distinct_count: i64 = row.try_get(current_idx + 1).unwrap_or(0);
        
        let mut min_val = None;
        let mut max_val = None;
        let mut mean_val = None;
        let mut stddev_val = None;

        if meta.is_numeric {
            min_val = row.try_get::<Option<String>, _>(current_idx + 2).unwrap_or(None);
            max_val = row.try_get::<Option<String>, _>(current_idx + 3).unwrap_or(None);
            mean_val = row.try_get::<Option<f64>, _>(current_idx + 4).ok().flatten();
            stddev_val = row.try_get::<Option<f64>, _>(current_idx + 5).ok().flatten();
        }

        current_idx += 6;

        let null_pct = if sample_row_count > 0 {
            (null_count as f32 / sample_row_count as f32) * 100.0
        } else {
            0.0
        };
        let distinct_pct = if sample_row_count > 0 {
            (distinct_count as f32 / sample_row_count as f32) * 100.0
        } else {
            0.0
        };

        if null_pct > 50.0 {
            issues.push(DataQualityIssue {
                issue_type: IssueType::HighNullRate,
                severity: IssueSeverity::Warning,
                description: format!("Column '{}' has {:.1}% NULL values.", meta.name, null_pct),
                column_name: Some(meta.name.clone()),
                affected_row_count: Some(null_count as u64),
                drill_down_query: Some(format!("SELECT * FROM {}.{} WHERE \"{}\" IS NULL LIMIT 50", schema, table, meta.name)),
            });
        }

        if let (Some(u), Some(s)) = (mean_val, stddev_val) {
            if s > 0.0 {
                let outlier_query = format!(
                    "SELECT COUNT(*) FROM {}.{} {} WHERE ABS(\"{}\"::numeric - {}) > 3 * {}",
                    schema, table, tablesample, meta.name, u, s
                );
                if let Ok(count) = sqlx::query_scalar::<_, i64>(&outlier_query).fetch_one(pool).await {
                    if count > 0 {
                        issues.push(DataQualityIssue {
                            issue_type: IssueType::OutlierDetected,
                            severity: IssueSeverity::Info,
                            description: format!("Column '{}' has {} outliers (> 3 stddev).", meta.name, count),
                            column_name: Some(meta.name.clone()),
                            affected_row_count: Some(count as u64),
                            drill_down_query: Some(format!(
                                "SELECT * FROM {}.{} WHERE ABS(\"{}\"::numeric - {}) > 3 * {} LIMIT 50",
                                schema, table, meta.name, u, s
                            )),
                        });
                    }
                }
            }
        }

        let top_values_query = format!(
            "SELECT val, COUNT(*) as cnt FROM (SELECT \"{}\"::text as val FROM {}.{} {} WHERE \"{}\" IS NOT NULL) t GROUP BY val ORDER BY cnt DESC LIMIT 5",
            meta.name, schema, table, tablesample, meta.name
        );
        let mut top_values = Vec::new();
        if let Ok(rows) = sqlx::query(&top_values_query).fetch_all(pool).await {
            for row in rows {
                let value: Option<String> = row.try_get(0).ok();
                let count: i64 = row.try_get(1).unwrap_or(0);
                if let Some(v) = value {
                    top_values.push(ValueCount { value: v, count: count as u64 });
                }
            }
        }

        let mut pattern_metrics = Vec::new();
        let patterns = [
            ("Email", r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"),
            ("Phone", r"^\+?[0-9]{10,15}$"),
            ("UUID", r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
            ("IP Address", r"^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$"),
        ];

        for (name, regex) in patterns {
            let pattern_query = format!(
                "SELECT COUNT(*) FROM {}.{} {} WHERE \"{}\"::text ~ '{}'",
                schema, table, tablesample, meta.name, regex
            );
            if let Ok(count) = sqlx::query_scalar::<_, i64>(&pattern_query).fetch_one(pool).await {
                if count > 0 {
                    pattern_metrics.push(PatternMetric {
                        pattern_name: name.to_string(),
                        count: count as u64,
                        percentage: (count as f32 / sample_row_count as f32) * 100.0,
                    });
                }
            }
        }

        column_metrics.push(ColumnQualityMetrics {
            column_name: meta.name,
            null_count: null_count as u64,
            null_percentage: null_pct,
            distinct_count: distinct_count as u64,
            distinct_percentage: distinct_pct,
            min_value: min_val,
            max_value: max_val,
            mean_value: mean_val,
            top_values: if top_values.is_empty() { None } else { Some(top_values) },
            pattern_metrics: if pattern_metrics.is_empty() { None } else { Some(pattern_metrics) },
        });
    }

    if !column_metrics.is_empty() && sample_percent.is_none() {
        let all_cols = column_metrics
            .iter()
            .map(|c| format!("\"{}\"", c.column_name))
            .collect::<Vec<_>>()
            .join(", ");
        let dup_query = format!(
            "SELECT SUM(cnt - 1) FROM (SELECT COUNT(*) as cnt FROM {}.{} GROUP BY {} HAVING COUNT(*) > 1) as t",
            schema, table, all_cols
        );

        let dup_count: Option<i64> = sqlx::query_scalar(&dup_query)
            .fetch_one(pool)
            .await
            .unwrap_or(None);

        if let Some(dups) = dup_count {
            if dups > 0 {
                issues.push(DataQualityIssue {
                    issue_type: IssueType::DuplicateRows,
                    severity: IssueSeverity::Warning,
                    description: format!("Found {} exact duplicate rows.", dups),
                    column_name: None,
                    affected_row_count: Some(dups as u64),
                    drill_down_query: Some(format!(
                        "SELECT *, COUNT(*) as dup_cnt FROM {}.{} GROUP BY {} HAVING COUNT(*) > 1 LIMIT 50",
                        schema, table, all_cols
                    )),
                });
            }
        }
    }

    let fk_query = format!(
        "SELECT
            kcu.column_name, 
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name 
        FROM 
            information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='{}' AND tc.table_name='{}'",
        schema, table
    );

    let fks: Vec<(String, String, String)> = sqlx::query_as(&fk_query)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    for (col, parent_tbl, parent_col) in fks {
        let orphan_query = format!(
            "SELECT COUNT(*) FROM {}.{} c LEFT JOIN {}.{} p ON c.\"{}\" = p.\"{}\" WHERE p.\"{}\" IS NULL AND c.\"{}\" IS NOT NULL",
            schema, table, schema, parent_tbl, col, parent_col, parent_col, col
        );

        let orphan_count: i64 = sqlx::query_scalar(&orphan_query)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

        if orphan_count > 0 {
            issues.push(DataQualityIssue {
                issue_type: IssueType::ReferentialIntegrityFailure,
                severity: IssueSeverity::Critical,
                description: format!(
                    "Found {} orphaned rows in column '{}' referencing {}.{}",
                    orphan_count, col, parent_tbl, parent_col
                ),
                column_name: Some(col.clone()),
                affected_row_count: Some(orphan_count as u64),
                drill_down_query: Some(format!(
                    "SELECT c.* FROM {}.{} c LEFT JOIN {}.{} p ON c.\"{}\" = p.\"{}\" WHERE p.\"{}\" IS NULL AND c.\"{}\" IS NOT NULL LIMIT 50",
                    schema, table, schema, parent_tbl, col, parent_col, parent_col, col
                )),
            });
        }
    }

    Ok(TableQualityReport {
        id: None,
        connection_id: connection_id.to_string(),
        table_name: table.to_string(),
        timestamp: chrono::Utc::now(),
        overall_score: calculate_score(&issues),
        row_count: total_row_count as u64,
        column_metrics,
        issues,
        schema_snapshot_id: None,
        schema_name: Some(schema.to_string()),
    })
}
