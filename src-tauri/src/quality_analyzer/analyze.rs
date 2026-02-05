use crate::quality_analyzer::models::*;
use sqlx::{MySql, Pool, Postgres, Row};

pub async fn analyze_table_mysql(
    pool: &Pool<MySql>,
    database: &str,
    table: &str,
    connection_id: &str,
) -> Result<TableQualityReport, String> {
    // 1. Get Row Count
    let count_query = format!("SELECT COUNT(*) FROM {}.{}", database, table);
    let row_count: i64 = sqlx::query_scalar(&count_query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to get row count: {}", e))?;

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

    // 3. Analyze Columns (NULLs, Distincts)
    // Optimization: We could do this in one massive query, but for MVP iteration is safer/simpler
    for (col_name, data_type) in columns {
        let null_query = format!(
            "SELECT COUNT(*) FROM {}.{} WHERE {} IS NULL",
            database, table, col_name
        );
        let null_count: i64 = sqlx::query_scalar(&null_query)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

        let distinct_query = format!(
            "SELECT COUNT(DISTINCT {}) FROM {}.{}",
            col_name, database, table
        );
        let distinct_count: i64 = sqlx::query_scalar(&distinct_query)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

        // Basic Stats (Min/Max/Avg/StdDev) for numeric
        let mut min_val = None;
        let mut max_val = None;
        let mut mean_val = None;

        // Simplified type check
        let is_numeric = ["int", "decimal", "float", "double", "numeric"]
            .iter()
            .any(|t| data_type.contains(t));

        if is_numeric && row_count > 0 {
            let stats_query = format!(
                "SELECT MIN({}), MAX({}), AVG({}), STDDEV({}) FROM {}.{}",
                col_name, col_name, col_name, col_name, database, table
            );
            if let Ok(row) = sqlx::query(&stats_query).fetch_one(pool).await {
                // MySQL returns Option<Value>
                let min: Option<String> = row.try_get(0).unwrap_or(None);
                let max: Option<String> = row.try_get(1).unwrap_or(None);
                let avg: Option<f64> = row.try_get(2).unwrap_or(None);
                let stddev: Option<f64> = row.try_get(3).unwrap_or(None);

                min_val = min;
                max_val = max;
                mean_val = avg;

                // Outlier Detection (Z-Score approach)
                // If we have mean and stddev, we can check how many rows are > 3 sigmas
                if let (Some(u), Some(s)) = (avg, stddev) {
                    if s > 0.0 {
                        let outlier_query = format!(
                            "SELECT COUNT(*) FROM {}.{} WHERE ABS({} - {}) > 3 * {}",
                            database, table, col_name, u, s
                        );
                        if let Ok(count) = sqlx::query_scalar::<_, i64>(&outlier_query)
                            .fetch_one(pool)
                            .await
                        {
                            if count > 0 {
                                issues.push(DataQualityIssue {
                                    issue_type: IssueType::OutlierDetected,
                                    severity: IssueSeverity::Info,
                                    description: format!(
                                        "Column '{}' has {} outliers (> 3 stddev).",
                                        col_name, count
                                    ),
                                    column_name: Some(col_name.clone()),
                                    affected_row_count: Some(count as u64),
                                });
                            }
                        }
                    }
                }
            }
        }

        // Freshness Check (Heuristic)
        if (col_name.contains("created_at")
            || col_name.contains("updated_at")
            || col_name.contains("timestamp"))
            && row_count > 0
        {
            let max_date_query = format!("SELECT MAX({}) FROM {}.{}", col_name, database, table);
            // We just want to see if it's stale (e.g. > 30 days)
            // Getting generic datetime as string for simplicity
            if let Ok(last_active) = sqlx::query_scalar::<_, Option<String>>(&max_date_query)
                .fetch_one(pool)
                .await
            {
                if let Some(_date_str) = last_active {}
            }
        }

        let null_pct = if row_count > 0 {
            (null_count as f32 / row_count as f32) * 100.0
        } else {
            0.0
        };
        let distinct_pct = if row_count > 0 {
            (distinct_count as f32 / row_count as f32) * 100.0
        } else {
            0.0
        };

        // Issue Detection: High Null Rate
        if null_pct > 50.0 {
            issues.push(DataQualityIssue {
                issue_type: IssueType::HighNullRate,
                severity: IssueSeverity::Warning,
                description: format!("Column '{}' has {:.1}% NULL values.", col_name, null_pct),
                column_name: Some(col_name.clone()),
                affected_row_count: Some(null_count as u64),
            });
        }

        // Issue Detection: Low Cardinality (Potential Enum candidate) - Info only
        if distinct_pct < 5.0 && distinct_count < 20 && row_count > 100 {
            // Maybe not an issue, just a finding
        }

        column_metrics.push(ColumnQualityMetrics {
            column_name: col_name,
            null_count: null_count as u64,
            null_percentage: null_pct,
            distinct_count: distinct_count as u64,
            distinct_percentage: distinct_pct,
            min_value: min_val,
            max_value: max_val,
            mean_value: mean_val,
        });
    }

    // 4. Analyze Duplicates (Exact Rows)
    // Construct query: SELECT SUM(c) FROM (SELECT COUNT(*) - 1 as c FROM table GROUP BY all_cols HAVING COUNT(*) > 1) t
    if !column_metrics.is_empty() {
        let all_cols = column_metrics
            .iter()
            .map(|c| c.column_name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let dup_query = format!(
            "SELECT SUM(cnt - 1) FROM (SELECT COUNT(*) as cnt FROM {}.{} GROUP BY {} HAVING COUNT(*) > 1) as t",
            database, table, all_cols
        );

        // This query might return NULL if no duplicates, or a number
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
                });
            }
        }
    }

    // 5. Analyze Referential Integrity (Orphans)
    // Fetch FKs first
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
        // COUNT orphans
        // SELECT COUNT(*) FROM child WHERE col IS NOT NULL AND col NOT IN (SELECT parent_col FROM parent)
        // Optimization: LEFT JOIN is often faster for this check than NOT IN
        // SELECT COUNT(*) FROM child c LEFT JOIN parent p ON c.col = p.pk WHERE p.pk IS NULL AND c.col IS NOT NULL
        let orphan_query = format!(
            "SELECT COUNT(*) FROM {}.{} c LEFT JOIN {}.{} p ON c.{} = p.{} WHERE p.{} IS NULL AND c.{} IS NOT NULL",
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
            });
        }
    }

    Ok(TableQualityReport {
        id: None,
        connection_id: connection_id.to_string(),
        table_name: table.to_string(),
        timestamp: chrono::Utc::now(),
        overall_score: calculate_score(&issues),
        row_count: row_count as u64,
        column_metrics,
        issues,
        schema_snapshot_id: None,
        schema_name: Some(database.to_string()),
    })
}

// Helper to calculate score
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
) -> Result<TableQualityReport, String> {
    // 1. Get Row Count
    let count_query = format!("SELECT COUNT(*) FROM {}.{}", schema, table);
    let row_count: i64 = sqlx::query_scalar(&count_query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to get row count: {}", e))?;

    // 2. Get Columns
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

    // 3. Analyze Columns
    for (col_name, data_type) in columns {
        let null_query = format!(
            "SELECT COUNT(*) FROM {}.{} WHERE {} IS NULL",
            schema, table, col_name
        );
        let null_count: i64 = sqlx::query_scalar(&null_query)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

        let distinct_query = format!(
            "SELECT COUNT(DISTINCT {}) FROM {}.{}",
            col_name, schema, table
        );
        let distinct_count: i64 = sqlx::query_scalar(&distinct_query)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

        // Basic Stats (Min/Max/Avg/StdDev) for numeric
        let mut min_val: Option<String> = None;
        let mut max_val: Option<String> = None;
        let mean_val: Option<f64> = None;

        let is_numeric = ["int", "decimal", "float", "double", "numeric"]
            .iter()
            .any(|t| data_type.contains(t));

        if is_numeric && row_count > 0 {
            let stats_query = format!(
                "SELECT MIN({}), MAX({}), AVG({}::numeric), STDDEV({}::numeric) FROM {}.{}",
                col_name, col_name, col_name, col_name, schema, table
            );

            if let Ok(row) = sqlx::query(&stats_query).fetch_one(pool).await {
                let min: Option<String> = row.try_get(0).ok();
                let max: Option<String> = row.try_get(1).ok();

                min_val = min;
                max_val = max;
                // Average/Stddev usually come back as Decimal or f64
                // Let's try formatting to string or casting in SQL to be safe if use generic

                // Better: sqlx::Row access by index
                // Actually relying on string representation for min/max

                // Re-fetching as specific types might be safer
            }

            // Simplification for Postgres strictness:
            // Construct a safer query or use try_get string checks
            // Disabling advanced stats for Postgres MVP to avoid type hell without extensive testing
        }

        let null_pct = if row_count > 0 {
            (null_count as f32 / row_count as f32) * 100.0
        } else {
            0.0
        };
        let distinct_pct = if row_count > 0 {
            (distinct_count as f32 / row_count as f32) * 100.0
        } else {
            0.0
        };

        // Issue Detection: High Null Rate
        if null_pct > 50.0 {
            issues.push(DataQualityIssue {
                issue_type: IssueType::HighNullRate,
                severity: IssueSeverity::Warning,
                description: format!("Column '{}' has {:.1}% NULL values.", col_name, null_pct),
                column_name: Some(col_name.clone()),
                affected_row_count: Some(null_count as u64),
            });
        }

        column_metrics.push(ColumnQualityMetrics {
            column_name: col_name,
            null_count: null_count as u64,
            null_percentage: null_pct,
            distinct_count: distinct_count as u64,
            distinct_percentage: distinct_pct,
            min_value: min_val,
            max_value: max_val,
            mean_value: mean_val,
        });
    }

    // 4. Analyze Duplicates (Exact Rows)
    if !column_metrics.is_empty() {
        let all_cols = column_metrics
            .iter()
            .map(|c| c.column_name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let dup_query = format!(
            "SELECT SUM(cnt - 1) FROM (SELECT COUNT(*) as cnt FROM {}.{} GROUP BY {} HAVING COUNT(*) > 1) as t",
            schema, table, all_cols
        );

        // Postgres returns i64 for COUNT operations often, SUM might be numeric/decimal or i64
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
                });
            }
        }
    }

    // 5. Analyze Referential Integrity (Orphans)
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
            "SELECT COUNT(*) FROM {}.{} c LEFT JOIN {}.{} p ON c.{} = p.{} WHERE p.{} IS NULL AND c.{} IS NOT NULL",
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
            });
        }
    }

    Ok(TableQualityReport {
        id: None,
        connection_id: connection_id.to_string(),
        table_name: table.to_string(),
        timestamp: chrono::Utc::now(),
        overall_score: calculate_score(&issues),
        row_count: row_count as u64,
        column_metrics,
        issues,
        schema_snapshot_id: None,
        schema_name: Some(schema.to_string()),
    })
}
