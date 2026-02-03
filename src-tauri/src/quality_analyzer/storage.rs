use sqlx::{Pool, Sqlite, Row};
use crate::quality_analyzer::models::TableQualityReport;

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
            
            CREATE INDEX IF NOT EXISTS idx_quality_conn_table ON quality_reports(connection_id, table_name);
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
                .map_err(|e| format!("Failed to migrate quality_reports table (schema_name): {}", e))?;
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
    
    pub async fn get_reports(&self, connection_id: &str) -> Result<Vec<TableQualityReport>, String> {
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
            
            let mut report: TableQualityReport = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
            report.id = Some(id);
            // If the blob didn't have schema_name (old records), use the column value if present
            if report.schema_name.is_none() {
                report.schema_name = schema_name;
            }
            reports.push(report);
        }
        
        Ok(reports)
    }
}
