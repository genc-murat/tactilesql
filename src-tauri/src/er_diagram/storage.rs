use crate::er_diagram::models::{ErLayoutRecord, ErLayoutSummary};
use chrono::Utc;
use sqlx::{sqlite::SqliteRow, Pool, Row, Sqlite};

pub struct ErDiagramStore {
    pool: Pool<Sqlite>,
}

impl ErDiagramStore {
    pub async fn new(pool: Pool<Sqlite>) -> Result<Self, String> {
        let store = Self { pool };
        store.init_schema().await?;
        Ok(store)
    }

    async fn init_schema(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS er_diagram_layouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                database_name TEXT NOT NULL,
                diagram_name TEXT NOT NULL,
                layout_payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(connection_id, database_name, diagram_name)
            );

            CREATE INDEX IF NOT EXISTS idx_er_diagram_layouts_lookup
                ON er_diagram_layouts(connection_id, database_name, diagram_name);

            CREATE INDEX IF NOT EXISTS idx_er_diagram_layouts_updated
                ON er_diagram_layouts(updated_at);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to init er_diagram schema: {}", e))?;

        Ok(())
    }

    pub async fn save_layout(
        &self,
        connection_id: &str,
        database_name: &str,
        diagram_name: &str,
        payload: &serde_json::Value,
    ) -> Result<ErLayoutRecord, String> {
        let now = Utc::now().timestamp();
        let payload_text = serde_json::to_string(payload).map_err(|e| e.to_string())?;

        let row = sqlx::query(
            r#"
            INSERT INTO er_diagram_layouts (
                connection_id,
                database_name,
                diagram_name,
                layout_payload,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(connection_id, database_name, diagram_name)
            DO UPDATE SET
                layout_payload = excluded.layout_payload,
                updated_at = excluded.updated_at
            RETURNING
                id,
                connection_id,
                database_name,
                diagram_name,
                layout_payload,
                created_at,
                updated_at
            "#,
        )
        .bind(connection_id)
        .bind(database_name)
        .bind(diagram_name)
        .bind(payload_text)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to save ER layout: {}", e))?;

        Self::row_to_layout_record(&row)
    }

    pub async fn get_layout(
        &self,
        connection_id: &str,
        database_name: &str,
        diagram_name: &str,
    ) -> Result<Option<ErLayoutRecord>, String> {
        let row = sqlx::query(
            r#"
            SELECT
                id,
                connection_id,
                database_name,
                diagram_name,
                layout_payload,
                created_at,
                updated_at
            FROM er_diagram_layouts
            WHERE connection_id = ? AND database_name = ? AND diagram_name = ?
            "#,
        )
        .bind(connection_id)
        .bind(database_name)
        .bind(diagram_name)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch ER layout: {}", e))?;

        match row {
            Some(row) => Ok(Some(Self::row_to_layout_record(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn list_layouts(
        &self,
        connection_id: &str,
        database_name: &str,
    ) -> Result<Vec<ErLayoutSummary>, String> {
        let rows = sqlx::query(
            r#"
            SELECT
                id,
                connection_id,
                database_name,
                diagram_name,
                created_at,
                updated_at
            FROM er_diagram_layouts
            WHERE connection_id = ? AND database_name = ?
            ORDER BY updated_at DESC
            "#,
        )
        .bind(connection_id)
        .bind(database_name)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to list ER layouts: {}", e))?;

        let mut layouts = Vec::new();
        for row in rows {
            layouts.push(Self::row_to_layout_summary(&row)?);
        }

        Ok(layouts)
    }

    pub async fn delete_layout(
        &self,
        connection_id: &str,
        database_name: &str,
        diagram_name: &str,
    ) -> Result<bool, String> {
        let result = sqlx::query(
            "DELETE FROM er_diagram_layouts WHERE connection_id = ? AND database_name = ? AND diagram_name = ?",
        )
        .bind(connection_id)
        .bind(database_name)
        .bind(diagram_name)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to delete ER layout: {}", e))?;

        Ok(result.rows_affected() > 0)
    }

    fn row_to_layout_record(row: &SqliteRow) -> Result<ErLayoutRecord, String> {
        let payload_text: String = row
            .try_get("layout_payload")
            .map_err(|e| format!("Failed to read ER payload: {}", e))?;
        let payload = serde_json::from_str(&payload_text)
            .map_err(|e| format!("Failed to decode ER payload: {}", e))?;

        let created_at_ts: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let updated_at_ts: i64 = row.try_get("updated_at").map_err(|e| e.to_string())?;

        Ok(ErLayoutRecord {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            connection_id: row.try_get("connection_id").map_err(|e| e.to_string())?,
            database_name: row.try_get("database_name").map_err(|e| e.to_string())?,
            diagram_name: row.try_get("diagram_name").map_err(|e| e.to_string())?,
            payload,
            created_at: Self::timestamp_to_datetime(created_at_ts),
            updated_at: Self::timestamp_to_datetime(updated_at_ts),
        })
    }

    fn row_to_layout_summary(row: &SqliteRow) -> Result<ErLayoutSummary, String> {
        let created_at_ts: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let updated_at_ts: i64 = row.try_get("updated_at").map_err(|e| e.to_string())?;

        Ok(ErLayoutSummary {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            connection_id: row.try_get("connection_id").map_err(|e| e.to_string())?,
            database_name: row.try_get("database_name").map_err(|e| e.to_string())?,
            diagram_name: row.try_get("diagram_name").map_err(|e| e.to_string())?,
            created_at: Self::timestamp_to_datetime(created_at_ts),
            updated_at: Self::timestamp_to_datetime(updated_at_ts),
        })
    }

    fn timestamp_to_datetime(ts: i64) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::<chrono::Utc>::from_timestamp(ts, 0).unwrap_or_else(chrono::Utc::now)
    }
}
