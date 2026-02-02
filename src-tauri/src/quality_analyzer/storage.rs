use sqlx::{Pool, Sqlite};

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
            CREATE TABLE IF NOT EXISTS quality_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                table_name TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                row_count INTEGER NOT NULL,
                duplicate_count INTEGER NOT NULL,
                duplicate_rate REAL NOT NULL,
                freshness_seconds INTEGER,
                quality_score REAL NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS column_statistics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metrics_id INTEGER NOT NULL,
                column_name TEXT NOT NULL,
                null_rate REAL NOT NULL,
                cardinality INTEGER NOT NULL,
                min_value TEXT,
                max_value TEXT,
                mean REAL,
                median REAL,
                std_dev REAL,
                outlier_count INTEGER,
                FOREIGN KEY (metrics_id) REFERENCES quality_metrics(id)
            );
            
            CREATE TABLE IF NOT EXISTS integrity_violations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metrics_id INTEGER NOT NULL,
                foreign_key_name TEXT NOT NULL,
                parent_table TEXT NOT NULL,
                child_table TEXT NOT NULL,
                orphaned_count INTEGER NOT NULL,
                FOREIGN KEY (metrics_id) REFERENCES quality_metrics(id)
            );
            
            CREATE INDEX IF NOT EXISTS idx_metrics_connection ON quality_metrics(connection_id, table_name, timestamp);
            CREATE INDEX IF NOT EXISTS idx_column_stats_metrics ON column_statistics(metrics_id);
            CREATE INDEX IF NOT EXISTS idx_violations_metrics ON integrity_violations(metrics_id);
            "#
        )
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to init quality_analyzer schema: {}", e))?;

        Ok(())
    }
}
