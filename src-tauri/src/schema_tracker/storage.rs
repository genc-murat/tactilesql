use sqlx::{Pool, Sqlite, Row, sqlite::SqliteRow};
use crate::schema_tracker::models::{SchemaSnapshot, SchemaImpactAiReport};

pub struct SchemaTrackerStore {
    pool: Pool<Sqlite>,
}

impl SchemaTrackerStore {
    pub async fn new(pool: Pool<Sqlite>) -> Result<Self, String> {
        let store = Self { pool };
        store.init_schema().await?;
        Ok(store)
    }

    async fn init_schema(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS schema_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                schema_hash TEXT NOT NULL,
                snapshot_data BLOB NOT NULL,
                UNIQUE(connection_id, schema_hash)
            );
            
            CREATE TABLE IF NOT EXISTS schema_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL,
                tag TEXT,
                annotation TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (snapshot_id) REFERENCES schema_snapshots(id)
            );

            CREATE TABLE IF NOT EXISTS schema_ai_impact_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                base_snapshot_id INTEGER NOT NULL,
                target_snapshot_id INTEGER NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                analysis_text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(connection_id, base_snapshot_id, target_snapshot_id)
            );
            
            CREATE INDEX IF NOT EXISTS idx_snapshots_connection ON schema_snapshots(connection_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_versions_snapshot ON schema_versions(snapshot_id);
            CREATE INDEX IF NOT EXISTS idx_schema_ai_impact_pair ON schema_ai_impact_reports(connection_id, base_snapshot_id, target_snapshot_id);
            "#
        )
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to init schema_tracker schema: {}", e))?;

        Ok(())
    }

    pub async fn save_snapshot(&self, snapshot: &SchemaSnapshot) -> Result<i64, String> {
        let data = serde_json::to_vec(snapshot).map_err(|e| e.to_string())?;
        
        let id = sqlx::query(
            r#"
            INSERT INTO schema_snapshots (connection_id, timestamp, schema_hash, snapshot_data)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(connection_id, schema_hash) DO UPDATE SET timestamp = excluded.timestamp
            RETURNING id
            "#
        )
        .bind(&snapshot.connection_id)
        .bind(snapshot.timestamp.timestamp())
        .bind(&snapshot.schema_hash)
        .bind(data)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to save snapshot: {}", e))?
        .try_get::<i64, _>("id")
        .map_err(|e| e.to_string())?;

        Ok(id)
    }

    pub async fn get_snapshots(&self, connection_id: &str) -> Result<Vec<SchemaSnapshot>, String> {
        let rows = sqlx::query(
            "SELECT id, snapshot_data FROM schema_snapshots WHERE connection_id = ? ORDER BY timestamp DESC"
        )
        .bind(connection_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch snapshots: {}", e))?;

        let mut snapshots = Vec::new();
        for row in rows {
            let id: i64 = row.try_get("id").unwrap_or_default();
            let data: Vec<u8> = row.try_get("snapshot_data").unwrap_or_default();
            let mut snapshot: SchemaSnapshot = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
            snapshot.id = Some(id);
            snapshots.push(snapshot);
        }
        
        Ok(snapshots)
    }

    pub async fn add_version_tag(&self, snapshot_id: i64, tag: &str, annotation: &str) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO schema_versions (snapshot_id, tag, annotation, created_at) VALUES (?, ?, ?, ?)"
        )
        .bind(snapshot_id)
        .bind(tag)
        .bind(annotation)
        .bind(chrono::Utc::now().timestamp())
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to add tag: {}", e))?;

        Ok(())
    }

    pub async fn save_ai_impact_report(
        &self,
        connection_id: &str,
        base_snapshot_id: i64,
        target_snapshot_id: i64,
        provider: &str,
        model: &str,
        analysis_text: &str,
    ) -> Result<SchemaImpactAiReport, String> {
        let now = chrono::Utc::now().timestamp();

        let row = sqlx::query(
            r#"
            INSERT INTO schema_ai_impact_reports (
                connection_id,
                base_snapshot_id,
                target_snapshot_id,
                provider,
                model,
                analysis_text,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(connection_id, base_snapshot_id, target_snapshot_id)
            DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                analysis_text = excluded.analysis_text,
                updated_at = excluded.updated_at
            RETURNING
                id,
                connection_id,
                base_snapshot_id,
                target_snapshot_id,
                provider,
                model,
                analysis_text,
                created_at,
                updated_at
            "#
        )
        .bind(connection_id)
        .bind(base_snapshot_id)
        .bind(target_snapshot_id)
        .bind(provider)
        .bind(model)
        .bind(analysis_text)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to save AI impact report: {}", e))?;

        Self::row_to_ai_impact_report(&row)
    }

    pub async fn get_ai_impact_report(
        &self,
        connection_id: &str,
        base_snapshot_id: i64,
        target_snapshot_id: i64,
    ) -> Result<Option<SchemaImpactAiReport>, String> {
        let row = sqlx::query(
            r#"
            SELECT
                id,
                connection_id,
                base_snapshot_id,
                target_snapshot_id,
                provider,
                model,
                analysis_text,
                created_at,
                updated_at
            FROM schema_ai_impact_reports
            WHERE connection_id = ? AND base_snapshot_id = ? AND target_snapshot_id = ?
            "#
        )
        .bind(connection_id)
        .bind(base_snapshot_id)
        .bind(target_snapshot_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch AI impact report: {}", e))?;

        match row {
            Some(row) => Ok(Some(Self::row_to_ai_impact_report(&row)?)),
            None => Ok(None),
        }
    }

    fn row_to_ai_impact_report(row: &SqliteRow) -> Result<SchemaImpactAiReport, String> {
        let created_at_ts: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let updated_at_ts: i64 = row.try_get("updated_at").map_err(|e| e.to_string())?;

        Ok(SchemaImpactAiReport {
            id: Some(row.try_get("id").map_err(|e| e.to_string())?),
            connection_id: row.try_get("connection_id").map_err(|e| e.to_string())?,
            base_snapshot_id: row.try_get("base_snapshot_id").map_err(|e| e.to_string())?,
            target_snapshot_id: row.try_get("target_snapshot_id").map_err(|e| e.to_string())?,
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
