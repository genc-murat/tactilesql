use sqlx::{Pool, Sqlite, Row};
use crate::schema_tracker::models::SchemaSnapshot;

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
            
            CREATE INDEX IF NOT EXISTS idx_snapshots_connection ON schema_snapshots(connection_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_versions_snapshot ON schema_versions(snapshot_id);
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
}
