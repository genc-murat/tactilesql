use crate::query_story::models::*;
use chrono::{DateTime, Utc};
use sqlx::{Pool, Row, Sqlite};

pub struct QueryStoryStore {
    pool: Pool<Sqlite>,
}

impl QueryStoryStore {
    pub async fn new(pool: Pool<Sqlite>) -> Result<Self, String> {
        let store = Self { pool };
        store.init_schema().await?;
        Ok(store)
    }

    async fn init_schema(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS query_stories (
                id TEXT PRIMARY KEY,
                query_hash TEXT UNIQUE NOT NULL,
                query_text TEXT NOT NULL,
                author TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                context_data BLOB NOT NULL,
                tags TEXT NOT NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                execution_count INTEGER NOT NULL DEFAULT 0,
                last_executed INTEGER,
                related_queries TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS query_versions (
                id TEXT PRIMARY KEY,
                query_hash TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                query_text TEXT NOT NULL,
                changed_at INTEGER NOT NULL,
                author TEXT NOT NULL,
                change_reason TEXT NOT NULL,
                diff_summary TEXT,
                performance_before BLOB,
                performance_after BLOB,
                FOREIGN KEY (query_hash) REFERENCES query_stories(query_hash) ON DELETE CASCADE,
                UNIQUE(query_hash, version_number)
            );

            CREATE TABLE IF NOT EXISTS query_comments (
                id TEXT PRIMARY KEY,
                query_hash TEXT NOT NULL,
                author TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                line_reference INTEGER,
                parent_id TEXT,
                FOREIGN KEY (query_hash) REFERENCES query_stories(query_hash) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_stories_hash ON query_stories(query_hash);
            CREATE INDEX IF NOT EXISTS idx_stories_author ON query_stories(author);
            CREATE INDEX IF NOT EXISTS idx_stories_favorite ON query_stories(is_favorite);
            CREATE INDEX IF NOT EXISTS idx_versions_hash ON query_versions(query_hash);
            CREATE INDEX IF NOT EXISTS idx_comments_hash ON query_comments(query_hash);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to init query_story schema: {}", e))?;

        Ok(())
    }

    pub async fn create_story(
        &self,
        request: CreateQueryStoryRequest,
    ) -> Result<QueryStory, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let query_hash = Self::calculate_query_hash(&request.query_text);
        let now = Utc::now();

        let context_data = serde_json::to_vec(&request.context).map_err(|e| e.to_string())?;
        let tags_json = serde_json::to_string(&request.tags).map_err(|e| e.to_string())?;

        sqlx::query(
            r#"
            INSERT INTO query_stories 
            (id, query_hash, query_text, author, created_at, updated_at, context_data, tags, is_favorite, execution_count, related_queries)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&id)
        .bind(&query_hash)
        .bind(&request.query_text)
        .bind(&request.author)
        .bind(now.timestamp())
        .bind(now.timestamp())
        .bind(&context_data)
        .bind(&tags_json)
        .bind(0i32)
        .bind(0i32)
        .bind("[]")
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to create story: {}", e))?;

        // Create initial version
        let version_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO query_versions 
            (id, query_hash, version_number, query_text, changed_at, author, change_reason, diff_summary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&version_id)
        .bind(&query_hash)
        .bind(1i32)
        .bind(&request.query_text)
        .bind(now.timestamp())
        .bind(&request.author)
        .bind("Initial version")
        .bind("First version of the query")
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to create initial version: {}", e))?;

        self.get_story(&query_hash)
            .await?
            .ok_or_else(|| "Failed to retrieve created story".to_string())
    }

    pub async fn get_story(&self, query_hash: &str) -> Result<Option<QueryStory>, String> {
        let row = sqlx::query("SELECT * FROM query_stories WHERE query_hash = ?")
            .bind(query_hash)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| format!("Failed to fetch story: {}", e))?;

        if let Some(row) = row {
            let story = self.row_to_story(&row).await?;
            Ok(Some(story))
        } else {
            Ok(None)
        }
    }

    pub async fn get_all_stories(&self, limit: i64) -> Result<Vec<StorySummary>, String> {
        let rows = sqlx::query(
            r#"
            SELECT 
                qs.query_hash,
                qs.author,
                qs.updated_at,
                qs.is_favorite,
                qs.tags,
                qs.context_data,
                COUNT(qv.id) as version_count
            FROM query_stories qs
            LEFT JOIN query_versions qv ON qs.query_hash = qv.query_hash
            GROUP BY qs.query_hash
            ORDER BY qs.updated_at DESC
            LIMIT ?
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch stories: {}", e))?;

        let mut summaries = Vec::new();
        for row in rows {
            let context_data: Vec<u8> = row.try_get("context_data").unwrap_or_default();
            let context: QueryContext = serde_json::from_slice(&context_data).unwrap_or_default();

            let tags_json: String = row.try_get("tags").unwrap_or_default();
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            summaries.push(StorySummary {
                query_hash: row.try_get("query_hash").unwrap_or_default(),
                purpose: context.purpose,
                author: row.try_get("author").unwrap_or_default(),
                version_count: row.try_get::<i64, _>("version_count").unwrap_or(0) as u32,
                last_updated: Self::timestamp_to_datetime(row.try_get("updated_at").unwrap_or(0)),
                is_favorite: row.try_get::<i32, _>("is_favorite").unwrap_or(0) == 1,
                tags,
            });
        }

        Ok(summaries)
    }

    pub async fn add_version(&self, request: AddVersionRequest) -> Result<QueryVersion, String> {
        // Get current max version number
        let max_version: i32 = sqlx::query(
            "SELECT COALESCE(MAX(version_number), 0) FROM query_versions WHERE query_hash = ?",
        )
        .bind(&request.query_hash)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to get max version: {}", e))?
        .try_get(0)
        .unwrap_or(0);

        let new_version_number = max_version + 1;
        let version_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();

        // Generate diff summary
        let old_query = self
            .get_query_text_at_version(&request.query_hash, max_version as u32)
            .await?;
        let diff_summary = Self::generate_diff_summary(&old_query, &request.new_query_text);

        let perf_before = request
            .performance_before
            .as_ref()
            .map(|p| serde_json::to_vec(p).ok())
            .flatten();
        let perf_after = request
            .performance_after
            .as_ref()
            .map(|p| serde_json::to_vec(p).ok())
            .flatten();

        sqlx::query(
            r#"
            INSERT INTO query_versions 
            (id, query_hash, version_number, query_text, changed_at, author, change_reason, diff_summary, performance_before, performance_after)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&version_id)
        .bind(&request.query_hash)
        .bind(new_version_number)
        .bind(&request.new_query_text)
        .bind(now.timestamp())
        .bind(&request.author)
        .bind(&request.change_reason)
        .bind(&diff_summary)
        .bind(&perf_before)
        .bind(&perf_after)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to add version: {}", e))?;

        // Update story's updated_at and query_text
        sqlx::query("UPDATE query_stories SET updated_at = ?, query_text = ? WHERE query_hash = ?")
            .bind(now.timestamp())
            .bind(&request.new_query_text)
            .bind(&request.query_hash)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to update story: {}", e))?;

        Ok(QueryVersion {
            version_id,
            version_number: new_version_number as u32,
            query_text: request.new_query_text,
            changed_at: now,
            author: request.author,
            change_reason: request.change_reason,
            diff_summary,
            performance_before: request.performance_before,
            performance_after: request.performance_after,
        })
    }

    pub async fn add_comment(&self, request: AddCommentRequest) -> Result<Comment, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query(
            r#"
            INSERT INTO query_comments 
            (id, query_hash, author, text, created_at, line_reference, parent_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(&request.query_hash)
        .bind(&request.author)
        .bind(&request.text)
        .bind(now.timestamp())
        .bind(request.line_reference.map(|l| l as i32))
        .bind(&request.parent_id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to add comment: {}", e))?;

        Ok(Comment {
            id,
            author: request.author,
            text: request.text,
            created_at: now,
            line_reference: request.line_reference,
            parent_id: request.parent_id,
        })
    }

    pub async fn update_context(&self, request: UpdateContextRequest) -> Result<(), String> {
        let context_data = serde_json::to_vec(&request.context).map_err(|e| e.to_string())?;
        let tags_json = serde_json::to_string(&request.tags).map_err(|e| e.to_string())?;
        let now = Utc::now();

        sqlx::query(
            "UPDATE query_stories SET context_data = ?, tags = ?, updated_at = ? WHERE query_hash = ?"
        )
        .bind(&context_data)
        .bind(&tags_json)
        .bind(now.timestamp())
        .bind(&request.query_hash)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to update context: {}", e))?;

        Ok(())
    }

    pub async fn toggle_favorite(&self, query_hash: &str) -> Result<bool, String> {
        let current: i32 =
            sqlx::query("SELECT is_favorite FROM query_stories WHERE query_hash = ?")
                .bind(query_hash)
                .fetch_one(&self.pool)
                .await
                .map_err(|e| format!("Failed to get favorite status: {}", e))?
                .try_get(0)
                .unwrap_or(0);

        let new_status = if current == 1 { 0 } else { 1 };

        sqlx::query("UPDATE query_stories SET is_favorite = ? WHERE query_hash = ?")
            .bind(new_status)
            .bind(query_hash)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to toggle favorite: {}", e))?;

        Ok(new_status == 1)
    }

    pub async fn increment_execution(&self, query_hash: &str) -> Result<(), String> {
        let now = Utc::now();

        sqlx::query(
            "UPDATE query_stories SET execution_count = execution_count + 1, last_executed = ? WHERE query_hash = ?"
        )
        .bind(now.timestamp())
        .bind(query_hash)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to increment execution: {}", e))?;

        Ok(())
    }

    pub async fn compare_versions(
        &self,
        query_hash: &str,
        version1: u32,
        version2: u32,
    ) -> Result<DiffResult, String> {
        let v1 = self.get_version(query_hash, version1).await?;
        let v2 = self.get_version(query_hash, version2).await?;

        let diff_lines = Self::compute_diff(&v1.query_text, &v2.query_text);
        let summary = Self::generate_diff_summary(&v1.query_text, &v2.query_text);

        Ok(DiffResult {
            old_version: v1,
            new_version: v2,
            diff_lines,
            summary,
        })
    }

    pub async fn delete_story(&self, query_hash: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM query_stories WHERE query_hash = ?")
            .bind(query_hash)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete story: {}", e))?;

        Ok(())
    }

    // Helper methods
    async fn row_to_story(&self, row: &sqlx::sqlite::SqliteRow) -> Result<QueryStory, String> {
        let query_hash: String = row.try_get("query_hash").unwrap_or_default();

        let context_data: Vec<u8> = row.try_get("context_data").unwrap_or_default();
        let context: QueryContext =
            serde_json::from_slice(&context_data).map_err(|e| e.to_string())?;

        let tags_json: String = row.try_get("tags").unwrap_or_default();
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

        let related_json: String = row.try_get("related_queries").unwrap_or_default();
        let related_queries: Vec<String> = serde_json::from_str(&related_json).unwrap_or_default();

        // Fetch versions
        let versions = self.get_versions(&query_hash).await?;

        // Fetch comments
        let comments = self.get_comments(&query_hash).await?;

        Ok(QueryStory {
            id: row.try_get("id").unwrap_or_default(),
            query_hash: query_hash.clone(),
            query_text: row.try_get("query_text").unwrap_or_default(),
            author: row.try_get("author").unwrap_or_default(),
            created_at: Self::timestamp_to_datetime(row.try_get("created_at").unwrap_or(0)),
            updated_at: Self::timestamp_to_datetime(row.try_get("updated_at").unwrap_or(0)),
            context,
            versions,
            comments,
            tags,
            is_favorite: row.try_get::<i32, _>("is_favorite").unwrap_or(0) == 1,
            execution_count: row.try_get::<i32, _>("execution_count").unwrap_or(0) as u32,
            last_executed: row
                .try_get::<i64, _>("last_executed")
                .ok()
                .map(Self::timestamp_to_datetime),
            related_queries,
        })
    }

    async fn get_versions(&self, query_hash: &str) -> Result<Vec<QueryVersion>, String> {
        let rows = sqlx::query(
            "SELECT * FROM query_versions WHERE query_hash = ? ORDER BY version_number ASC",
        )
        .bind(query_hash)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch versions: {}", e))?;

        let mut versions = Vec::new();
        for row in rows {
            let perf_before: Option<Vec<u8>> = row.try_get("performance_before").ok();
            let perf_after: Option<Vec<u8>> = row.try_get("performance_after").ok();

            versions.push(QueryVersion {
                version_id: row.try_get("id").unwrap_or_default(),
                version_number: row.try_get::<i32, _>("version_number").unwrap_or(0) as u32,
                query_text: row.try_get("query_text").unwrap_or_default(),
                changed_at: Self::timestamp_to_datetime(row.try_get("changed_at").unwrap_or(0)),
                author: row.try_get("author").unwrap_or_default(),
                change_reason: row.try_get("change_reason").unwrap_or_default(),
                diff_summary: row.try_get("diff_summary").unwrap_or_default(),
                performance_before: perf_before.and_then(|d| serde_json::from_slice(&d).ok()),
                performance_after: perf_after.and_then(|d| serde_json::from_slice(&d).ok()),
            });
        }

        Ok(versions)
    }

    async fn get_comments(&self, query_hash: &str) -> Result<Vec<Comment>, String> {
        let rows = sqlx::query(
            "SELECT * FROM query_comments WHERE query_hash = ? ORDER BY created_at ASC",
        )
        .bind(query_hash)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch comments: {}", e))?;

        let mut comments = Vec::new();
        for row in rows {
            comments.push(Comment {
                id: row.try_get("id").unwrap_or_default(),
                author: row.try_get("author").unwrap_or_default(),
                text: row.try_get("text").unwrap_or_default(),
                created_at: Self::timestamp_to_datetime(row.try_get("created_at").unwrap_or(0)),
                line_reference: row
                    .try_get::<i32, _>("line_reference")
                    .ok()
                    .map(|l| l as u32),
                parent_id: row.try_get("parent_id").ok(),
            });
        }

        Ok(comments)
    }

    async fn get_version(
        &self,
        query_hash: &str,
        version_number: u32,
    ) -> Result<QueryVersion, String> {
        let row =
            sqlx::query("SELECT * FROM query_versions WHERE query_hash = ? AND version_number = ?")
                .bind(query_hash)
                .bind(version_number as i32)
                .fetch_one(&self.pool)
                .await
                .map_err(|e| format!("Failed to fetch version: {}", e))?;

        let perf_before: Option<Vec<u8>> = row.try_get("performance_before").ok();
        let perf_after: Option<Vec<u8>> = row.try_get("performance_after").ok();

        Ok(QueryVersion {
            version_id: row.try_get("id").unwrap_or_default(),
            version_number: row.try_get::<i32, _>("version_number").unwrap_or(0) as u32,
            query_text: row.try_get("query_text").unwrap_or_default(),
            changed_at: Self::timestamp_to_datetime(row.try_get("changed_at").unwrap_or(0)),
            author: row.try_get("author").unwrap_or_default(),
            change_reason: row.try_get("change_reason").unwrap_or_default(),
            diff_summary: row.try_get("diff_summary").unwrap_or_default(),
            performance_before: perf_before.and_then(|d| serde_json::from_slice(&d).ok()),
            performance_after: perf_after.and_then(|d| serde_json::from_slice(&d).ok()),
        })
    }

    async fn get_query_text_at_version(
        &self,
        query_hash: &str,
        version_number: u32,
    ) -> Result<String, String> {
        let text: String = sqlx::query(
            "SELECT query_text FROM query_versions WHERE query_hash = ? AND version_number = ?",
        )
        .bind(query_hash)
        .bind(version_number as i32)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to get query text: {}", e))?
        .try_get(0)
        .unwrap_or_default();

        Ok(text)
    }

    fn calculate_query_hash(query: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(query.trim().to_lowercase().as_bytes());
        format!("{:x}", hasher.finalize())
    }

    fn timestamp_to_datetime(timestamp: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(timestamp, 0).unwrap_or_else(|| Utc::now())
    }

    fn generate_diff_summary(old: &str, new: &str) -> String {
        let old_lines = old.lines().count();
        let new_lines = new.lines().count();

        if old == new {
            "No changes".to_string()
        } else if new_lines > old_lines {
            format!("Added {} lines", new_lines - old_lines)
        } else if new_lines < old_lines {
            format!("Removed {} lines", old_lines - new_lines)
        } else {
            "Modified content".to_string()
        }
    }

    fn compute_diff(old: &str, new: &str) -> Vec<DiffLine> {
        use similar::{ChangeTag, TextDiff};

        let diff = TextDiff::from_lines(old, new);
        let mut lines = Vec::new();
        let mut line_num = 1u32;

        for change in diff.iter_all_changes() {
            let change_type = match change.tag() {
                ChangeTag::Delete => ChangeType::Removed,
                ChangeTag::Insert => ChangeType::Added,
                ChangeTag::Equal => ChangeType::Unchanged,
            };

            let value = change.value().to_string();

            lines.push(DiffLine {
                line_number: line_num,
                old_content: if matches!(change_type, ChangeType::Removed | ChangeType::Unchanged) {
                    Some(value.clone())
                } else {
                    None
                },
                new_content: if matches!(change_type, ChangeType::Added | ChangeType::Unchanged) {
                    Some(value)
                } else {
                    None
                },
                change_type,
            });

            if !matches!(change.tag(), ChangeTag::Delete) {
                line_num += 1;
            }
        }

        lines
    }
}
