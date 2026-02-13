use crate::quality_analyzer::models::{CustomRule, QualityAiReport, TableQualityReport};
use sqlx::{sqlite::SqliteRow, Pool, Row, Sqlite};

pub struct QualityAnalyzerStore {
    pool: Pool<Sqlite>,
}

impl QualityAnalyzerStore {
    pub async fn new(pool: Pool<Sqlite>) -> Result<Self, String> {
        let store = Self { pool };
        store.init_schema().await?;
        Ok(store)
    }

    async fn init_schema(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS quality_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                table_name TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                overall_score REAL NOT NULL,
                report_data BLOB NOT NULL,
                schema_snapshot_id INTEGER,
                schema_name TEXT
            );

            CREATE TABLE IF NOT EXISTS quality_ai_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quality_report_id INTEGER NOT NULL UNIQUE,
                connection_id TEXT NOT NULL,
                table_name TEXT NOT NULL,
                schema_name TEXT,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                analysis_text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS quality_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                table_name TEXT NOT NULL,
                schema_name TEXT,
                rule_name TEXT NOT NULL,
                sql_assertion TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_quality_conn_table ON quality_reports(connection_id, table_name);
            CREATE INDEX IF NOT EXISTS idx_quality_ai_conn_report ON quality_ai_reports(connection_id, quality_report_id);
            CREATE INDEX IF NOT EXISTS idx_quality_rules_conn_table ON quality_rules(connection_id, table_name);
            "#
        )
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to init quality_analyzer schema: {}", e))?;

        // Migration: Add schema_snapshot_id if it doesn't exist
        // (SQLite CREATE TABLE IF NOT EXISTS doesn't add missing columns to existing tables)
        let columns = sqlx::query("PRAGMA table_info(quality_reports)")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        let has_column = columns.iter().any(|row| {
            let name: String = row.try_get("name").unwrap_or_default();
            name == "schema_snapshot_id"
        });

        if !has_column {
            sqlx::query("ALTER TABLE quality_reports ADD COLUMN schema_snapshot_id INTEGER")
                .execute(&self.pool)
                .await
                .map_err(|e| format!("Failed to migrate quality_reports table: {}", e))?;
        }

        let has_schema_name = columns.iter().any(|row| {
            let name: String = row.try_get("name").unwrap_or_default();
            name == "schema_name"
        });

        if !has_schema_name {
            sqlx::query("ALTER TABLE quality_reports ADD COLUMN schema_name TEXT")
                .execute(&self.pool)
                .await
                .map_err(|e| {
                    format!(
                        "Failed to migrate quality_reports table (schema_name): {}",
                        e
                    )
                })?;
        }

        Ok(())
    }

    pub async fn save_report(&self, report: &TableQualityReport) -> Result<i64, String> {
        let data = serde_json::to_vec(report).map_err(|e| e.to_string())?;

        let id = sqlx::query(
            r#"
            INSERT INTO quality_reports (connection_id, table_name, timestamp, overall_score, report_data, schema_snapshot_id, schema_name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            "#
        )
        .bind(&report.connection_id)
        .bind(&report.table_name)
        .bind(report.timestamp.timestamp())
        .bind(report.overall_score)
        .bind(data)
        .bind(report.schema_snapshot_id)
        .bind(&report.schema_name)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to save report: {}", e))?
        .try_get::<i64, _>("id")
        .map_err(|e| e.to_string())?;

        Ok(id)
    }

    pub async fn get_reports(
        &self,
        connection_id: &str,
    ) -> Result<Vec<TableQualityReport>, String> {
        let rows = sqlx::query(
            "SELECT id, report_data, schema_name FROM quality_reports WHERE connection_id = ? ORDER BY timestamp DESC LIMIT 50"
        )
        .bind(connection_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch reports: {}", e))?;

        let mut reports = Vec::new();
        for row in rows {
            let id: i64 = row.try_get("id").unwrap_or_default();
            let data: Vec<u8> = row.try_get("report_data").unwrap_or_default();
            let schema_name: Option<String> = row.try_get("schema_name").unwrap_or(None);

            let mut report: TableQualityReport =
                serde_json::from_slice(&data).map_err(|e| e.to_string())?;
            report.id = Some(id);
            // If the blob didn't have schema_name (old records), use the column value if present
            if report.schema_name.is_none() {
                report.schema_name = schema_name;
            }
            reports.push(report);
        }

        Ok(reports)
    }

    pub async fn save_ai_report(
        &self,
        connection_id: &str,
        quality_report_id: i64,
        table_name: &str,
        schema_name: Option<&str>,
        provider: &str,
        model: &str,
        analysis_text: &str,
    ) -> Result<QualityAiReport, String> {
        let now = chrono::Utc::now().timestamp();

        let row = sqlx::query(
            r#"
            INSERT INTO quality_ai_reports (
                quality_report_id,
                connection_id,
                table_name,
                schema_name,
                provider,
                model,
                analysis_text,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(quality_report_id)
            DO UPDATE SET
                connection_id = excluded.connection_id,
                table_name = excluded.table_name,
                schema_name = excluded.schema_name,
                provider = excluded.provider,
                model = excluded.model,
                analysis_text = excluded.analysis_text,
                updated_at = excluded.updated_at
            RETURNING
                id,
                quality_report_id,
                connection_id,
                table_name,
                schema_name,
                provider,
                model,
                analysis_text,
                created_at,
                updated_at
            "#,
        )
        .bind(quality_report_id)
        .bind(connection_id)
        .bind(table_name)
        .bind(schema_name)
        .bind(provider)
        .bind(model)
        .bind(analysis_text)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to save quality AI report: {}", e))?;

        Self::row_to_ai_report(&row)
    }

    pub async fn get_ai_report(
        &self,
        connection_id: &str,
        quality_report_id: i64,
    ) -> Result<Option<QualityAiReport>, String> {
        let row = sqlx::query(
            r#"
            SELECT
                id,
                quality_report_id,
                connection_id,
                table_name,
                schema_name,
                provider,
                model,
                analysis_text,
                created_at,
                updated_at
            FROM quality_ai_reports
            WHERE connection_id = ? AND quality_report_id = ?
            "#,
        )
        .bind(connection_id)
        .bind(quality_report_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch quality AI report: {}", e))?;

        match row {
            Some(row) => Ok(Some(Self::row_to_ai_report(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn save_rule(&self, rule: &CustomRule) -> Result<i64, String> {
        let now = chrono::Utc::now().timestamp();
        let id = sqlx::query(
            r#"
            INSERT INTO quality_rules (connection_id, table_name, schema_name, rule_name, sql_assertion, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            "#
        )
        .bind(&rule.connection_id)
        .bind(&rule.table_name)
        .bind(&rule.schema_name)
        .bind(&rule.rule_name)
        .bind(&rule.sql_assertion)
        .bind(if rule.is_active { 1 } else { 0 })
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to save rule: {}", e))?
        .try_get::<i64, _>("id")
        .map_err(|e| e.to_string())?;

        Ok(id)
    }

    pub async fn get_rules(&self, connection_id: &str, table_name: &str, schema_name: Option<&str>) -> Result<Vec<CustomRule>, String> {
        let rows = sqlx::query(
            "SELECT * FROM quality_rules WHERE connection_id = ? AND table_name = ? AND (schema_name = ? OR schema_name IS NULL)"
        )
        .bind(connection_id)
        .bind(table_name)
        .bind(schema_name)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch rules: {}", e))?;

        let mut rules = Vec::new();
        for row in rows {
            rules.push(CustomRule {
                id: Some(row.try_get("id").unwrap_or_default()),
                connection_id: row.try_get("connection_id").unwrap_or_default(),
                table_name: row.try_get("table_name").unwrap_or_default(),
                schema_name: row.try_get("schema_name").ok(),
                rule_name: row.try_get("rule_name").unwrap_or_default(),
                sql_assertion: row.try_get("sql_assertion").unwrap_or_default(),
                is_active: row.try_get::<i32, _>("is_active").unwrap_or(1) == 1,
                created_at: Self::timestamp_to_datetime(row.try_get("created_at").unwrap_or_default()),
            });
        }
        Ok(rules)
    }

    pub async fn delete_rule(&self, id: i64) -> Result<(), String> {
        sqlx::query("DELETE FROM quality_rules WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete rule: {}", e))?;
        Ok(())
    }

    fn row_to_ai_report(row: &SqliteRow) -> Result<QualityAiReport, String> {
        let created_at_ts: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let updated_at_ts: i64 = row.try_get("updated_at").map_err(|e| e.to_string())?;

        Ok(QualityAiReport {
            id: Some(row.try_get("id").map_err(|e| e.to_string())?),
            quality_report_id: row
                .try_get("quality_report_id")
                .map_err(|e| e.to_string())?,
            connection_id: row.try_get("connection_id").map_err(|e| e.to_string())?,
            table_name: row.try_get("table_name").map_err(|e| e.to_string())?,
            schema_name: row.try_get("schema_name").map_err(|e| e.to_string())?,
            provider: row.try_get("provider").map_err(|e| e.to_string())?,
            model: row.try_get("model").map_err(|e| e.to_string())?,
            analysis_text: row.try_get("analysis_text").map_err(|e| e.to_string())?,
            created_at: Self::timestamp_to_datetime(created_at_ts),
            updated_at: Self::timestamp_to_datetime(updated_at_ts),
        })
    }

    fn timestamp_to_datetime(ts: i64) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::<chrono::Utc>::from_timestamp(ts, 0).unwrap_or_else(chrono::Utc::now)
    }
}
