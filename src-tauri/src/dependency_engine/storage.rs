use sqlx::{Pool, Sqlite};

pub struct DependencyEngineStore {
    pool: Pool<Sqlite>,
}

impl DependencyEngineStore {
    pub async fn new(pool: Pool<Sqlite>) -> Result<Self, String> {
        let store = Self { pool };
        store.init_schema().await?;
        Ok(store)
    }

    async fn init_schema(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS dependency_nodes (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                name TEXT NOT NULL,
                object_type TEXT NOT NULL,
                definition TEXT,
                last_updated INTEGER NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS dependency_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                from_node TEXT NOT NULL,
                to_node TEXT NOT NULL,
                dependency_type TEXT NOT NULL,
                operations TEXT,
                FOREIGN KEY (from_node) REFERENCES dependency_nodes(id),
                FOREIGN KEY (to_node) REFERENCES dependency_nodes(id)
            );
            
            CREATE TABLE IF NOT EXISTS circular_dependencies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                cycle_path TEXT NOT NULL,
                detected_at INTEGER NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_nodes_connection ON dependency_nodes(connection_id);
            CREATE INDEX IF NOT EXISTS idx_edges_connection ON dependency_edges(connection_id);
            CREATE INDEX IF NOT EXISTS idx_edges_from ON dependency_edges(from_node);
            CREATE INDEX IF NOT EXISTS idx_edges_to ON dependency_edges(to_node);
            "#
        )
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to init dependency_engine schema: {}", e))?;

        Ok(())
    }
}
