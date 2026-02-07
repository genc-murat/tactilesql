use crate::task_manager::models::{
    CompositeTaskEdge, CompositeTaskGraph, CompositeTaskStep,
    compute_initial_next_run_at, compute_next_after_fire, normalize_tags, CreateTaskRequest,
    CreateTaskTriggerRequest, ListTaskRunsRequest, ListTasksRequest, ListTaskTriggersRequest,
    CompositeStepRun, CompositeStepStatus, ListTaskAuditLogsRequest, LogLevel, MisfirePolicy,
    PurgeTaskHistoryResult, RunStatus, TaskAuditLog, TaskDefinition, TaskRun, TaskRunLog,
    TaskStatus, TaskTrigger, TaskType, TriggerType, UpdateTaskRequest, UpdateTaskTriggerRequest,
    UpsertCompositeTaskGraphRequest, validate_task_payload,
};
use crate::task_manager::security::{redact_sensitive_json, redact_sensitive_text};
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sqlx::{Pool, QueryBuilder, Row, Sqlite};

#[derive(Clone)]
pub struct TaskManagerStore {
    pool: Pool<Sqlite>,
}

const DEFAULT_TASK_LOG_RETENTION_DAYS: i64 = 30;
const TASK_LOG_RETENTION_DAYS_MIN: i64 = 1;
const TASK_LOG_RETENTION_DAYS_MAX: i64 = 3650;
const TASK_LOG_RETENTION_SETTING_KEY: &str = "task_run_log_retention_days";

impl TaskManagerStore {
    pub async fn new(pool: Pool<Sqlite>) -> Result<Self, String> {
        let store = Self { pool };
        store.init_schema().await?;
        Ok(store)
    }

    async fn init_schema(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL,
                payload TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                owner TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_triggers (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                cron_expression TEXT,
                interval_seconds INTEGER,
                run_at INTEGER,
                timezone TEXT,
                misfire_policy TEXT NOT NULL DEFAULT 'fire_now',
                retry_max_attempts INTEGER NOT NULL DEFAULT 0,
                retry_backoff_ms INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                next_run_at INTEGER,
                last_run_at INTEGER,
                claim_owner TEXT,
                claim_until INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS task_runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                trigger_id TEXT,
                status TEXT NOT NULL,
                attempt INTEGER NOT NULL DEFAULT 1,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                error_message TEXT,
                run_metadata TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (trigger_id) REFERENCES task_triggers(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS task_run_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                log_metadata TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS composite_tasks (
                task_id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS composite_steps (
                id TEXT PRIMARY KEY,
                composite_task_id TEXT NOT NULL,
                step_key TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                task_type TEXT,
                referenced_task_id TEXT,
                payload TEXT NOT NULL DEFAULT '{}',
                on_error TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(composite_task_id, step_key),
                FOREIGN KEY (composite_task_id) REFERENCES composite_tasks(task_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS composite_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                composite_task_id TEXT NOT NULL,
                from_step_key TEXT NOT NULL,
                to_step_key TEXT NOT NULL,
                condition_expr TEXT,
                created_at INTEGER NOT NULL,
                UNIQUE(composite_task_id, from_step_key, to_step_key),
                FOREIGN KEY (composite_task_id) REFERENCES composite_tasks(task_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS composite_step_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                step_key TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                error_message TEXT,
                step_metadata TEXT NOT NULL DEFAULT '{}',
                UNIQUE(run_id, step_key),
                FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS task_manager_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                task_id TEXT,
                actor TEXT,
                message TEXT NOT NULL,
                audit_metadata TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_task_runs_task_started ON task_runs(task_id, started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_task_triggers_next_enabled ON task_triggers(next_run_at, enabled);
            CREATE INDEX IF NOT EXISTS idx_task_triggers_task ON task_triggers(task_id);
            -- Index on claim_until moved to ensure_trigger_claim_columns to avoid init errors on existing tables
            CREATE INDEX IF NOT EXISTS idx_task_run_logs_run ON task_run_logs(run_id, created_at ASC);
            CREATE INDEX IF NOT EXISTS idx_task_run_logs_created ON task_run_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_composite_steps_task ON composite_steps(composite_task_id, position ASC);
            CREATE INDEX IF NOT EXISTS idx_composite_edges_task ON composite_edges(composite_task_id, from_step_key, to_step_key);
            CREATE INDEX IF NOT EXISTS idx_composite_step_runs_run ON composite_step_runs(run_id, position ASC, id ASC);
            CREATE INDEX IF NOT EXISTS idx_task_audit_logs_task_created ON task_audit_logs(task_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_task_audit_logs_created ON task_audit_logs(created_at DESC);
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to init task_manager schema: {}", e))?;

        self.ensure_trigger_claim_columns().await?;

        Ok(())
    }

    async fn ensure_trigger_claim_columns(&self) -> Result<(), String> {
        let columns = sqlx::query("PRAGMA table_info(task_triggers)")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to inspect task_triggers columns: {}", e))?;

        let has_claim_owner = columns.iter().any(|row| {
            let name: String = row.try_get("name").unwrap_or_default();
            name == "claim_owner"
        });
        let has_claim_until = columns.iter().any(|row| {
            let name: String = row.try_get("name").unwrap_or_default();
            name == "claim_until"
        });

        if !has_claim_owner {
            sqlx::query("ALTER TABLE task_triggers ADD COLUMN claim_owner TEXT")
                .execute(&self.pool)
                .await
                .map_err(|e| format!("Failed to migrate claim_owner column: {}", e))?;
        }
        if !has_claim_until {
            sqlx::query("ALTER TABLE task_triggers ADD COLUMN claim_until INTEGER")
                .execute(&self.pool)
                .await
                .map_err(|e| format!("Failed to migrate claim_until column: {}", e))?;
        }

        // Create index on claim_until after ensuring column exists
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_task_triggers_claim_until ON task_triggers(claim_until)")
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to create index on claim_until: {}", e))?;

        Ok(())
    }

    pub async fn create_task(&self, request: CreateTaskRequest) -> Result<TaskDefinition, String> {
        request.validate()?;

        let now = Utc::now().timestamp();
        let task = TaskDefinition {
            id: uuid::Uuid::new_v4().to_string(),
            name: request.name.trim().to_string(),
            description: request.description.and_then(trim_to_option),
            task_type: request.task_type,
            status: request.status,
            payload: normalized_payload(request.payload),
            tags: normalize_tags(&request.tags),
            owner: request.owner.and_then(trim_to_option),
            created_at: timestamp_to_datetime(now),
            updated_at: timestamp_to_datetime(now),
            last_run_status: None,
            last_run_at: None,
            next_run_at: None,
        };

        let payload_json =
            serde_json::to_string(&task.payload).map_err(|e| format!("Invalid payload: {}", e))?;
        let tags_json =
            serde_json::to_string(&task.tags).map_err(|e| format!("Invalid tags: {}", e))?;

        sqlx::query(
            r#"
            INSERT INTO tasks (
                id, name, description, task_type, status, payload, tags, owner, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&task.id)
        .bind(&task.name)
        .bind(&task.description)
        .bind(task.task_type.as_str())
        .bind(task.status.as_str())
        .bind(payload_json)
        .bind(tags_json)
        .bind(&task.owner)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to create task: {}", e))?;

        Ok(task)
    }

    pub async fn get_task(&self, task_id: &str) -> Result<Option<TaskDefinition>, String> {
        let row = sqlx::query(
            r#"
            SELECT
                id, name, description, task_type, status, payload, tags, owner, created_at, updated_at
            FROM tasks
            WHERE id = ?
            "#,
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch task: {}", e))?;

        match row {
            Some(row) => Ok(Some(Self::row_to_task(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn list_tasks(
        &self,
        request: ListTasksRequest,
    ) -> Result<Vec<TaskDefinition>, String> {
        let mut qb = QueryBuilder::<Sqlite>::new(
            r#"
            SELECT
                tasks.id,
                tasks.name,
                tasks.description,
                tasks.task_type,
                tasks.status,
                tasks.payload,
                tasks.tags,
                tasks.owner,
                tasks.created_at,
                tasks.updated_at,
                (
                    SELECT tr.status
                    FROM task_runs tr
                    WHERE tr.task_id = tasks.id
                    ORDER BY tr.started_at DESC
                    LIMIT 1
                ) AS last_run_status,
                (
                    SELECT tr.started_at
                    FROM task_runs tr
                    WHERE tr.task_id = tasks.id
                    ORDER BY tr.started_at DESC
                    LIMIT 1
                ) AS last_run_at,
                (
                    SELECT MIN(tt.next_run_at)
                    FROM task_triggers tt
                    WHERE tt.task_id = tasks.id
                      AND tt.enabled = 1
                      AND tt.next_run_at IS NOT NULL
                ) AS next_run_at
            FROM tasks
            WHERE 1=1
            "#,
        );

        if let Some(status) = request.status {
            qb.push(" AND status = ").push_bind(status.as_str());
        }
        if let Some(task_type) = request.task_type {
            qb.push(" AND task_type = ").push_bind(task_type.as_str());
        }
        if let Some(owner) = request.owner.and_then(trim_to_option) {
            qb.push(" AND owner = ").push_bind(owner);
        }
        if let Some(tag) = request.tag.and_then(trim_to_option) {
            qb.push(" AND EXISTS (SELECT 1 FROM json_each(tasks.tags) WHERE lower(value) = lower(")
                .push_bind(tag)
                .push("))");
        }
        if let Some(search) = request.search.and_then(trim_to_option) {
            let pattern = format!("%{}%", search.to_lowercase());
            qb.push(" AND (lower(name) LIKE ")
                .push_bind(pattern.clone())
                .push(" OR lower(COALESCE(description, '')) LIKE ")
                .push_bind(pattern)
                .push(")");
        }

        let sort_column = match request.sort_by.as_deref() {
            Some("name") => "name",
            Some("created_at") => "created_at",
            Some("status") => "status",
            _ => "updated_at",
        };
        let sort_order = if request.sort_desc.unwrap_or(true) {
            "DESC"
        } else {
            "ASC"
        };
        qb.push(" ORDER BY ").push(sort_column).push(" ").push(sort_order);

        let limit = request.limit.unwrap_or(100).clamp(1, 500);
        let offset = request.offset.unwrap_or(0).max(0);
        qb.push(" LIMIT ").push_bind(limit);
        qb.push(" OFFSET ").push_bind(offset);

        let rows = qb
            .build()
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to list tasks: {}", e))?;

        rows.iter()
            .map(Self::row_to_task)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn update_task(&self, request: UpdateTaskRequest) -> Result<TaskDefinition, String> {
        request.validate()?;

        let mut task = self
            .get_task(&request.task_id)
            .await?
            .ok_or_else(|| format!("Task '{}' not found", request.task_id))?;

        if let Some(name) = request.name {
            task.name = name.trim().to_string();
        }
        if let Some(description) = request.description {
            task.description = trim_to_option(description);
        }
        if let Some(task_type) = request.task_type {
            task.task_type = task_type;
        }
        if let Some(status) = request.status {
            task.status = status;
        }
        if let Some(payload) = request.payload {
            task.payload = normalized_payload(payload);
        }
        if let Some(tags) = request.tags {
            task.tags = normalize_tags(&tags);
        }
        if let Some(owner) = request.owner {
            task.owner = trim_to_option(owner);
        }
        validate_task_payload(&task.task_type, &task.payload)?;
        task.updated_at = Utc::now();

        let payload_json =
            serde_json::to_string(&task.payload).map_err(|e| format!("Invalid payload: {}", e))?;
        let tags_json =
            serde_json::to_string(&task.tags).map_err(|e| format!("Invalid tags: {}", e))?;

        sqlx::query(
            r#"
            UPDATE tasks
            SET name = ?, description = ?, task_type = ?, status = ?, payload = ?, tags = ?, owner = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(&task.name)
        .bind(&task.description)
        .bind(task.task_type.as_str())
        .bind(task.status.as_str())
        .bind(payload_json)
        .bind(tags_json)
        .bind(&task.owner)
        .bind(task.updated_at.timestamp())
        .bind(&task.id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to update task '{}': {}", task.id, e))?;

        Ok(task)
    }

    pub async fn delete_task(&self, task_id: &str) -> Result<(), String> {
        let result = sqlx::query("DELETE FROM tasks WHERE id = ?")
            .bind(task_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete task '{}': {}", task_id, e))?;

        if result.rows_affected() == 0 {
            return Err(format!("Task '{}' not found", task_id));
        }

        Ok(())
    }

    pub async fn create_trigger(
        &self,
        request: CreateTaskTriggerRequest,
    ) -> Result<TaskTrigger, String> {
        request.validate()?;
        let task = self
            .get_task(&request.task_id)
            .await?
            .ok_or_else(|| format!("Task '{}' not found", request.task_id))?;
        if task.status == TaskStatus::Disabled {
            return Err("Cannot create trigger for disabled task".to_string());
        }

        let now = Utc::now();
        let next_run_at = if request.enabled {
            compute_initial_next_run_at(
                &request.trigger_type,
                request.cron_expression.as_deref(),
                request.interval_seconds,
                request.run_at,
                now,
            )?
        } else {
            None
        };

        let trigger = TaskTrigger {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: request.task_id.trim().to_string(),
            trigger_type: request.trigger_type,
            cron_expression: request.cron_expression.and_then(trim_to_option),
            interval_seconds: request.interval_seconds,
            run_at: request.run_at,
            timezone: request.timezone.and_then(trim_to_option),
            misfire_policy: request.misfire_policy,
            retry_policy: request.retry_policy,
            enabled: request.enabled,
            next_run_at,
            last_run_at: None,
            claim_owner: None,
            claim_until: None,
            created_at: now,
            updated_at: now,
        };

        sqlx::query(
            r#"
            INSERT INTO task_triggers (
                id, task_id, trigger_type, cron_expression, interval_seconds, run_at, timezone,
                misfire_policy, retry_max_attempts, retry_backoff_ms, enabled, next_run_at,
                last_run_at, claim_owner, claim_until, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&trigger.id)
        .bind(&trigger.task_id)
        .bind(trigger.trigger_type.as_str())
        .bind(&trigger.cron_expression)
        .bind(trigger.interval_seconds)
        .bind(trigger.run_at.map(|v| v.timestamp()))
        .bind(&trigger.timezone)
        .bind(trigger.misfire_policy.as_str())
        .bind(trigger.retry_policy.max_attempts as i64)
        .bind(trigger.retry_policy.backoff_ms as i64)
        .bind(if trigger.enabled { 1 } else { 0 })
        .bind(trigger.next_run_at.map(|v| v.timestamp()))
        .bind(trigger.last_run_at.map(|v| v.timestamp()))
        .bind(&trigger.claim_owner)
        .bind(trigger.claim_until.map(|v| v.timestamp()))
        .bind(trigger.created_at.timestamp())
        .bind(trigger.updated_at.timestamp())
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to create trigger: {}", e))?;

        Ok(trigger)
    }

    pub async fn get_trigger(&self, trigger_id: &str) -> Result<Option<TaskTrigger>, String> {
        let row = sqlx::query(
            r#"
            SELECT
                id, task_id, trigger_type, cron_expression, interval_seconds, run_at, timezone,
                misfire_policy, retry_max_attempts, retry_backoff_ms, enabled, next_run_at, last_run_at,
                claim_owner, claim_until, created_at, updated_at
            FROM task_triggers
            WHERE id = ?
            "#,
        )
        .bind(trigger_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch trigger: {}", e))?;

        match row {
            Some(row) => Ok(Some(Self::row_to_trigger(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn list_triggers(
        &self,
        request: ListTaskTriggersRequest,
    ) -> Result<Vec<TaskTrigger>, String> {
        let mut qb = QueryBuilder::<Sqlite>::new(
            "SELECT id, task_id, trigger_type, cron_expression, interval_seconds, run_at, timezone, misfire_policy, retry_max_attempts, retry_backoff_ms, enabled, next_run_at, last_run_at, claim_owner, claim_until, created_at, updated_at FROM task_triggers WHERE 1=1",
        );

        if let Some(task_id) = request.task_id.and_then(trim_to_option) {
            qb.push(" AND task_id = ").push_bind(task_id);
        }
        if let Some(enabled) = request.enabled {
            qb.push(" AND enabled = ").push_bind(if enabled { 1 } else { 0 });
        }

        qb.push(" ORDER BY created_at DESC");
        qb.push(" LIMIT ").push_bind(request.limit.unwrap_or(200).clamp(1, 1000));
        qb.push(" OFFSET ").push_bind(request.offset.unwrap_or(0).max(0));

        let rows = qb
            .build()
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to list triggers: {}", e))?;

        rows.iter()
            .map(Self::row_to_trigger)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn update_trigger(
        &self,
        request: UpdateTaskTriggerRequest,
    ) -> Result<TaskTrigger, String> {
        request.validate()?;

        let mut trigger = self
            .get_trigger(&request.trigger_id)
            .await?
            .ok_or_else(|| format!("Trigger '{}' not found", request.trigger_id))?;

        if let Some(trigger_type) = request.trigger_type {
            trigger.trigger_type = trigger_type;
        }
        if let Some(cron_expression) = request.cron_expression {
            trigger.cron_expression = trim_to_option(cron_expression);
        }
        if let Some(interval_seconds) = request.interval_seconds {
            trigger.interval_seconds = Some(interval_seconds);
        }
        if let Some(run_at) = request.run_at {
            trigger.run_at = Some(run_at);
        }
        if let Some(timezone) = request.timezone {
            trigger.timezone = trim_to_option(timezone);
        }
        if let Some(misfire_policy) = request.misfire_policy {
            trigger.misfire_policy = misfire_policy;
        }
        if let Some(retry_policy) = request.retry_policy {
            trigger.retry_policy = retry_policy;
        }
        if let Some(enabled) = request.enabled {
            trigger.enabled = enabled;
        }

        crate::task_manager::models::validate_trigger_fields(
            &trigger.trigger_type,
            trigger.cron_expression.as_deref(),
            trigger.interval_seconds,
            trigger.run_at,
        )?;

        let now = Utc::now();
        trigger.updated_at = now;
        trigger.next_run_at = if trigger.enabled {
            compute_initial_next_run_at(
                &trigger.trigger_type,
                trigger.cron_expression.as_deref(),
                trigger.interval_seconds,
                trigger.run_at,
                now,
            )?
        } else {
            None
        };
        if !trigger.enabled {
            trigger.claim_owner = None;
            trigger.claim_until = None;
        }

        sqlx::query(
            r#"
            UPDATE task_triggers
            SET trigger_type = ?, cron_expression = ?, interval_seconds = ?, run_at = ?, timezone = ?,
                misfire_policy = ?, retry_max_attempts = ?, retry_backoff_ms = ?, enabled = ?, next_run_at = ?,
                last_run_at = ?, claim_owner = ?, claim_until = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(trigger.trigger_type.as_str())
        .bind(&trigger.cron_expression)
        .bind(trigger.interval_seconds)
        .bind(trigger.run_at.map(|v| v.timestamp()))
        .bind(&trigger.timezone)
        .bind(trigger.misfire_policy.as_str())
        .bind(trigger.retry_policy.max_attempts as i64)
        .bind(trigger.retry_policy.backoff_ms as i64)
        .bind(if trigger.enabled { 1 } else { 0 })
        .bind(trigger.next_run_at.map(|v| v.timestamp()))
        .bind(trigger.last_run_at.map(|v| v.timestamp()))
        .bind(&trigger.claim_owner)
        .bind(trigger.claim_until.map(|v| v.timestamp()))
        .bind(trigger.updated_at.timestamp())
        .bind(&trigger.id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to update trigger '{}': {}", trigger.id, e))?;

        Ok(trigger)
    }

    pub async fn delete_trigger(&self, trigger_id: &str) -> Result<(), String> {
        let result = sqlx::query("DELETE FROM task_triggers WHERE id = ?")
            .bind(trigger_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete trigger '{}': {}", trigger_id, e))?;

        if result.rows_affected() == 0 {
            return Err(format!("Trigger '{}' not found", trigger_id));
        }

        Ok(())
    }

    pub async fn upsert_composite_task_graph(
        &self,
        request: UpsertCompositeTaskGraphRequest,
    ) -> Result<CompositeTaskGraph, String> {
        request.validate()?;

        let task = self
            .get_task(&request.task_id)
            .await?
            .ok_or_else(|| format!("Task '{}' not found", request.task_id))?;
        if !matches!(task.task_type, TaskType::Composite) {
            return Err(format!(
                "Task '{}' is not a composite task",
                request.task_id
            ));
        }

        let now = Utc::now().timestamp();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| format!("Failed to start composite transaction: {}", e))?;

        sqlx::query(
            r#"
            INSERT INTO composite_tasks (task_id, created_at, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(task_id) DO UPDATE SET updated_at = excluded.updated_at
            "#,
        )
        .bind(request.task_id.trim())
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to upsert composite root '{}': {}", request.task_id, e))?;

        sqlx::query("DELETE FROM composite_edges WHERE composite_task_id = ?")
            .bind(request.task_id.trim())
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to clear composite edges '{}': {}", request.task_id, e))?;

        sqlx::query("DELETE FROM composite_steps WHERE composite_task_id = ?")
            .bind(request.task_id.trim())
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to clear composite steps '{}': {}", request.task_id, e))?;

        for step in &request.steps {
            let step_key = step.step_key.trim();
            let payload = normalized_payload(step.payload.clone());
            let payload_json =
                serde_json::to_string(&payload).map_err(|e| format!("Invalid step payload: {}", e))?;

            sqlx::query(
                r#"
                INSERT INTO composite_steps (
                    id, composite_task_id, step_key, position, task_type, referenced_task_id,
                    payload, on_error, enabled, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(format!("{}::{}", request.task_id.trim(), step_key))
            .bind(request.task_id.trim())
            .bind(step_key)
            .bind(step.position)
            .bind(step.task_type.as_ref().map(|value| value.as_str()))
            .bind(step.referenced_task_id.as_ref().and_then(|value| trim_to_option(value.clone())))
            .bind(payload_json)
            .bind(step.on_error.as_ref().and_then(|value| trim_to_option(value.clone())))
            .bind(if step.enabled { 1 } else { 0 })
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                format!(
                    "Failed to insert composite step '{}' for task '{}': {}",
                    step_key, request.task_id, e
                )
            })?;
        }

        for edge in &request.edges {
            sqlx::query(
                r#"
                INSERT INTO composite_edges (
                    composite_task_id, from_step_key, to_step_key, condition_expr, created_at
                )
                VALUES (?, ?, ?, ?, ?)
                "#,
            )
            .bind(request.task_id.trim())
            .bind(edge.from_step_key.trim())
            .bind(edge.to_step_key.trim())
            .bind(edge.condition.as_ref().and_then(|value| trim_to_option(value.clone())))
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                format!(
                    "Failed to insert composite edge '{} -> {}' for task '{}': {}",
                    edge.from_step_key, edge.to_step_key, request.task_id, e
                )
            })?;
        }

        tx.commit()
            .await
            .map_err(|e| format!("Failed to commit composite graph '{}': {}", request.task_id, e))?;

        self.get_composite_task_graph(&request.task_id)
            .await?
            .ok_or_else(|| format!("Failed to load composite graph '{}'", request.task_id))
    }

    pub async fn get_composite_task_graph(
        &self,
        task_id: &str,
    ) -> Result<Option<CompositeTaskGraph>, String> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err("task_id is required".to_string());
        }

        let root = sqlx::query(
            r#"
            SELECT task_id, created_at, updated_at
            FROM composite_tasks
            WHERE task_id = ?
            "#,
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch composite root '{}': {}", task_id, e))?;

        let Some(root_row) = root else {
            return Ok(None);
        };

        let created_at_ts: i64 = root_row.try_get("created_at").map_err(|e| e.to_string())?;
        let updated_at_ts: i64 = root_row.try_get("updated_at").map_err(|e| e.to_string())?;

        let step_rows = sqlx::query(
            r#"
            SELECT step_key, position, task_type, referenced_task_id, payload, on_error, enabled
            FROM composite_steps
            WHERE composite_task_id = ?
            ORDER BY position ASC, created_at ASC
            "#,
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch composite steps '{}': {}", task_id, e))?;

        let mut steps = Vec::with_capacity(step_rows.len());
        for row in step_rows {
            let payload_raw: String = row.try_get("payload").unwrap_or_else(|_| "{}".to_string());
            let payload: Value =
                serde_json::from_str(&payload_raw).map_err(|e| format!("Invalid step payload: {}", e))?;
            let task_type_raw: Option<String> = row.try_get("task_type").map_err(|e| e.to_string())?;

            steps.push(CompositeTaskStep {
                step_key: row.try_get("step_key").map_err(|e| e.to_string())?,
                position: row.try_get("position").map_err(|e| e.to_string())?,
                task_type: task_type_raw
                    .as_deref()
                    .map(TaskType::from_db)
                    .transpose()?,
                referenced_task_id: row.try_get("referenced_task_id").map_err(|e| e.to_string())?,
                payload,
                on_error: row.try_get("on_error").map_err(|e| e.to_string())?,
                enabled: row.try_get::<i32, _>("enabled").map_err(|e| e.to_string())? == 1,
            });
        }

        let edge_rows = sqlx::query(
            r#"
            SELECT from_step_key, to_step_key, condition_expr
            FROM composite_edges
            WHERE composite_task_id = ?
            ORDER BY id ASC
            "#,
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch composite edges '{}': {}", task_id, e))?;

        let edges = edge_rows
            .iter()
            .map(|row| {
                Ok(CompositeTaskEdge {
                    from_step_key: row.try_get("from_step_key").map_err(|e| e.to_string())?,
                    to_step_key: row.try_get("to_step_key").map_err(|e| e.to_string())?,
                    condition: row.try_get("condition_expr").map_err(|e| e.to_string())?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        Ok(Some(CompositeTaskGraph {
            task_id: task_id.to_string(),
            steps,
            edges,
            created_at: timestamp_to_datetime(created_at_ts),
            updated_at: timestamp_to_datetime(updated_at_ts),
        }))
    }

    pub async fn claim_due_triggers(
        &self,
        scheduler_id: &str,
        now: DateTime<Utc>,
        limit: i64,
        claim_ttl_secs: i64,
    ) -> Result<Vec<TaskTrigger>, String> {
        let now_ts = now.timestamp();
        let claim_until = now_ts + claim_ttl_secs.max(1);
        let batch_limit = limit.clamp(1, 100);

        let candidate_rows = sqlx::query(
            r#"
            SELECT tt.id
            FROM task_triggers tt
            JOIN tasks t ON t.id = tt.task_id
            WHERE tt.enabled = 1
              AND t.status = 'active'
              AND tt.next_run_at IS NOT NULL
              AND tt.next_run_at <= ?
              AND (tt.claim_until IS NULL OR tt.claim_until < ?)
            ORDER BY tt.next_run_at ASC
            LIMIT ?
            "#,
        )
        .bind(now_ts)
        .bind(now_ts)
        .bind(batch_limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch due triggers: {}", e))?;

        let mut claimed = Vec::new();
        for row in candidate_rows {
            let trigger_id: String = row.try_get("id").map_err(|e| e.to_string())?;
            let result = sqlx::query(
                r#"
                UPDATE task_triggers
                SET claim_owner = ?, claim_until = ?, updated_at = ?
                WHERE id = ?
                  AND enabled = 1
                  AND next_run_at IS NOT NULL
                  AND next_run_at <= ?
                  AND (claim_until IS NULL OR claim_until < ?)
                "#,
            )
            .bind(scheduler_id)
            .bind(claim_until)
            .bind(now_ts)
            .bind(&trigger_id)
            .bind(now_ts)
            .bind(now_ts)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to claim trigger '{}': {}", trigger_id, e))?;

            if result.rows_affected() == 1 {
                if let Some(trigger) = self.get_trigger(&trigger_id).await? {
                    claimed.push(trigger);
                }
            }
        }

        Ok(claimed)
    }

    pub async fn release_trigger_claim(
        &self,
        trigger_id: &str,
        scheduler_id: &str,
    ) -> Result<(), String> {
        let now = Utc::now().timestamp();
        sqlx::query(
            r#"
            UPDATE task_triggers
            SET claim_owner = NULL, claim_until = NULL, updated_at = ?
            WHERE id = ? AND (claim_owner = ? OR claim_owner IS NULL)
            "#,
        )
        .bind(now)
        .bind(trigger_id)
        .bind(scheduler_id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to release trigger claim '{}': {}", trigger_id, e))?;
        Ok(())
    }

    pub async fn finalize_trigger_after_dispatch(
        &self,
        trigger_id: &str,
        fired_at: DateTime<Utc>,
    ) -> Result<(), String> {
        let mut trigger = self
            .get_trigger(trigger_id)
            .await?
            .ok_or_else(|| format!("Trigger '{}' not found", trigger_id))?;

        trigger.last_run_at = Some(fired_at);
        trigger.next_run_at = compute_next_after_fire(&trigger, fired_at)?;
        if matches!(trigger.trigger_type, TriggerType::OneShot) {
            trigger.enabled = false;
        }
        trigger.claim_owner = None;
        trigger.claim_until = None;
        trigger.updated_at = Utc::now();

        sqlx::query(
            r#"
            UPDATE task_triggers
            SET enabled = ?, next_run_at = ?, last_run_at = ?, claim_owner = NULL, claim_until = NULL, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(if trigger.enabled { 1 } else { 0 })
        .bind(trigger.next_run_at.map(|v| v.timestamp()))
        .bind(trigger.last_run_at.map(|v| v.timestamp()))
        .bind(trigger.updated_at.timestamp())
        .bind(trigger_id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to finalize trigger '{}': {}", trigger_id, e))?;

        Ok(())
    }

    pub async fn handle_trigger_misfire(
        &self,
        trigger_id: &str,
        handled_at: DateTime<Utc>,
    ) -> Result<TaskTrigger, String> {
        let mut trigger = self
            .get_trigger(trigger_id)
            .await?
            .ok_or_else(|| format!("Trigger '{}' not found", trigger_id))?;

        match trigger.misfire_policy {
            MisfirePolicy::FireNow => {
                return Err(format!(
                    "Misfire policy fire_now does not require pre-dispatch handling for trigger '{}'",
                    trigger_id
                ));
            }
            MisfirePolicy::Skip => {
                trigger.next_run_at = compute_misfire_skip_next_run(&trigger, handled_at)?;
                if matches!(trigger.trigger_type, TriggerType::OneShot) {
                    trigger.enabled = false;
                }
            }
            MisfirePolicy::Reschedule => {
                trigger.next_run_at = compute_misfire_reschedule_next_run(&trigger, handled_at)?;
                if trigger.next_run_at.is_none() {
                    trigger.enabled = false;
                }
            }
        }

        trigger.claim_owner = None;
        trigger.claim_until = None;
        trigger.updated_at = Utc::now();

        sqlx::query(
            r#"
            UPDATE task_triggers
            SET enabled = ?, next_run_at = ?, claim_owner = NULL, claim_until = NULL, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(if trigger.enabled { 1 } else { 0 })
        .bind(trigger.next_run_at.map(|v| v.timestamp()))
        .bind(trigger.updated_at.timestamp())
        .bind(trigger_id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to handle misfire for trigger '{}': {}", trigger_id, e))?;

        Ok(trigger)
    }

    pub async fn create_task_run(
        &self,
        task_id: &str,
        trigger_id: Option<&str>,
        attempt: i32,
        status: RunStatus,
        run_metadata: Value,
    ) -> Result<TaskRun, String> {
        let run = TaskRun {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            trigger_id: trigger_id.map(str::to_string),
            status: status.clone(),
            attempt,
            started_at: Utc::now(),
            finished_at: if status.is_terminal() {
                Some(Utc::now())
            } else {
                None
            },
            error_message: None,
            run_metadata: normalized_payload(run_metadata),
        };

        let metadata_json = serde_json::to_string(&run.run_metadata)
            .map_err(|e| format!("Invalid run metadata: {}", e))?;

        sqlx::query(
            r#"
            INSERT INTO task_runs (
                id, task_id, trigger_id, status, attempt, started_at, finished_at, error_message, run_metadata
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&run.id)
        .bind(&run.task_id)
        .bind(&run.trigger_id)
        .bind(run.status.as_str())
        .bind(run.attempt)
        .bind(run.started_at.timestamp())
        .bind(run.finished_at.map(|v| v.timestamp()))
        .bind(&run.error_message)
        .bind(metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to create task run: {}", e))?;

        Ok(run)
    }

    pub async fn update_task_run_status(
        &self,
        run_id: &str,
        status: RunStatus,
        error_message: Option<String>,
        metadata: Option<Value>,
    ) -> Result<TaskRun, String> {
        let mut run = self
            .get_task_run(run_id)
            .await?
            .ok_or_else(|| format!("Run '{}' not found", run_id))?;

        if run.status == RunStatus::Cancelled && status != RunStatus::Cancelled {
            return Ok(run);
        }

        run.status = status;
        run.error_message = error_message
            .map(|value| redact_sensitive_text(&value))
            .and_then(trim_to_option);
        if let Some(metadata) = metadata {
            run.run_metadata = normalized_payload(redact_sensitive_json(&metadata));
        }
        if run.status.is_terminal() {
            run.finished_at = Some(Utc::now());
        } else if run.status == RunStatus::Running {
            run.finished_at = None;
        }

        let metadata_json = serde_json::to_string(&run.run_metadata)
            .map_err(|e| format!("Invalid run metadata: {}", e))?;

        sqlx::query(
            r#"
            UPDATE task_runs
            SET status = ?, finished_at = ?, error_message = ?, run_metadata = ?
            WHERE id = ?
            "#,
        )
        .bind(run.status.as_str())
        .bind(run.finished_at.map(|v| v.timestamp()))
        .bind(&run.error_message)
        .bind(metadata_json)
        .bind(&run.id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to update run '{}': {}", run.id, e))?;

        Ok(run)
    }

    pub async fn append_task_run_log(
        &self,
        run_id: &str,
        task_id: &str,
        level: LogLevel,
        message: &str,
        log_metadata: Value,
    ) -> Result<TaskRunLog, String> {
        let created_at = Utc::now();
        let sanitized_message = redact_sensitive_text(message);
        let normalized_log_metadata = normalized_payload(redact_sensitive_json(&log_metadata));
        let log_metadata_json = serde_json::to_string(&normalized_log_metadata)
            .map_err(|e| format!("Invalid run log metadata: {}", e))?;

        let row = sqlx::query(
            r#"
            INSERT INTO task_run_logs (run_id, task_id, level, message, created_at, log_metadata)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
            "#,
        )
        .bind(run_id)
        .bind(task_id)
        .bind(level.as_str())
        .bind(sanitized_message.trim())
        .bind(created_at.timestamp())
        .bind(log_metadata_json)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to insert task run log: {}", e))?;

        let log_id: i64 = row.try_get("id").map_err(|e| e.to_string())?;
        Ok(TaskRunLog {
            id: log_id,
            run_id: run_id.to_string(),
            task_id: task_id.to_string(),
            level,
            message: sanitized_message.trim().to_string(),
            created_at,
            log_metadata: normalized_log_metadata,
        })
    }

    pub async fn list_task_runs(&self, request: ListTaskRunsRequest) -> Result<Vec<TaskRun>, String> {
        if request.task_id.trim().is_empty() {
            return Err("task_id is required".to_string());
        }
        let limit = request.limit.unwrap_or(50).clamp(1, 500);
        let rows = sqlx::query(
            r#"
            SELECT id, task_id, trigger_id, status, attempt, started_at, finished_at, error_message, run_metadata
            FROM task_runs
            WHERE task_id = ?
            ORDER BY started_at DESC
            LIMIT ?
            "#,
        )
        .bind(request.task_id.trim())
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to list task runs: {}", e))?;

        rows.iter()
            .map(Self::row_to_task_run)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn list_task_run_logs(
        &self,
        run_id: &str,
        limit: i64,
    ) -> Result<Vec<TaskRunLog>, String> {
        let rows = sqlx::query(
            r#"
            SELECT id, run_id, task_id, level, message, created_at, log_metadata
            FROM task_run_logs
            WHERE run_id = ?
            ORDER BY created_at ASC
            LIMIT ?
            "#,
        )
        .bind(run_id)
        .bind(limit.clamp(1, 2000))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to list task run logs: {}", e))?;

        rows.iter()
            .map(Self::row_to_task_run_log)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn append_task_audit_log(
        &self,
        event_type: &str,
        task_id: Option<&str>,
        actor: Option<&str>,
        message: &str,
        audit_metadata: Value,
    ) -> Result<TaskAuditLog, String> {
        let event_type = event_type.trim();
        if event_type.is_empty() {
            return Err("event_type is required".to_string());
        }

        let created_at = Utc::now();
        let safe_message = redact_sensitive_text(message).trim().to_string();
        let safe_metadata = normalized_payload(redact_sensitive_json(&audit_metadata));
        let metadata_json = serde_json::to_string(&safe_metadata)
            .map_err(|e| format!("Invalid task audit metadata: {}", e))?;

        let row = sqlx::query(
            r#"
            INSERT INTO task_audit_logs (event_type, task_id, actor, message, audit_metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
            "#,
        )
        .bind(event_type)
        .bind(task_id.map(str::trim).filter(|value| !value.is_empty()))
        .bind(actor.map(str::trim).filter(|value| !value.is_empty()))
        .bind(&safe_message)
        .bind(metadata_json)
        .bind(created_at.timestamp())
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to append task audit log: {}", e))?;

        let id: i64 = row.try_get("id").map_err(|e| e.to_string())?;
        Ok(TaskAuditLog {
            id,
            event_type: event_type.to_string(),
            task_id: task_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            actor: actor
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            message: safe_message,
            created_at,
            audit_metadata: safe_metadata,
        })
    }

    pub async fn list_task_audit_logs(
        &self,
        request: ListTaskAuditLogsRequest,
    ) -> Result<Vec<TaskAuditLog>, String> {
        let limit = request.limit.unwrap_or(200).clamp(1, 2000);
        let offset = request.offset.unwrap_or(0).max(0);
        let task_id_filter = request
            .task_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let mut query = QueryBuilder::<Sqlite>::new(
            "SELECT id, event_type, task_id, actor, message, audit_metadata, created_at FROM task_audit_logs",
        );

        if let Some(task_id) = task_id_filter {
            query.push(" WHERE task_id = ");
            query.push_bind(task_id);
        }

        query.push(" ORDER BY created_at DESC, id DESC LIMIT ");
        query.push_bind(limit);
        query.push(" OFFSET ");
        query.push_bind(offset);

        let rows = query
            .build()
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to list task audit logs: {}", e))?;

        rows.iter()
            .map(|row| {
                let id: i64 = row.try_get("id").map_err(|e| e.to_string())?;
                let event_type: String = row.try_get("event_type").map_err(|e| e.to_string())?;
                let task_id: Option<String> = row.try_get("task_id").map_err(|e| e.to_string())?;
                let actor: Option<String> = row.try_get("actor").map_err(|e| e.to_string())?;
                let message: String = row.try_get("message").map_err(|e| e.to_string())?;
                let metadata_raw: String =
                    row.try_get("audit_metadata").unwrap_or_else(|_| "{}".to_string());
                let audit_metadata = serde_json::from_str(&metadata_raw)
                    .map_err(|e| format!("Failed to decode task audit metadata: {}", e))?;
                let created_at_ts: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;

                Ok(TaskAuditLog {
                    id,
                    event_type,
                    task_id,
                    actor,
                    message,
                    created_at: timestamp_to_datetime(created_at_ts),
                    audit_metadata,
                })
            })
            .collect::<Result<Vec<_>, String>>()
    }

    pub async fn get_task_log_retention_days(&self) -> Result<i64, String> {
        let value = self
            .get_setting(TASK_LOG_RETENTION_SETTING_KEY)
            .await?
            .and_then(|raw| raw.trim().parse::<i64>().ok())
            .unwrap_or(DEFAULT_TASK_LOG_RETENTION_DAYS);
        let normalized = value.clamp(TASK_LOG_RETENTION_DAYS_MIN, TASK_LOG_RETENTION_DAYS_MAX);
        Ok(normalized)
    }

    pub async fn set_task_log_retention_days(&self, retention_days: i64) -> Result<i64, String> {
        if !(TASK_LOG_RETENTION_DAYS_MIN..=TASK_LOG_RETENTION_DAYS_MAX).contains(&retention_days) {
            return Err(format!(
                "retention_days must be between {} and {}",
                TASK_LOG_RETENTION_DAYS_MIN, TASK_LOG_RETENTION_DAYS_MAX
            ));
        }

        let retention_value = retention_days.to_string();
        self.set_setting(TASK_LOG_RETENTION_SETTING_KEY, &retention_value)
            .await?;

        Ok(retention_days)
    }

    pub async fn purge_old_task_history(
        &self,
        retention_days: i64,
    ) -> Result<PurgeTaskHistoryResult, String> {
        if !(TASK_LOG_RETENTION_DAYS_MIN..=TASK_LOG_RETENTION_DAYS_MAX).contains(&retention_days) {
            return Err(format!(
                "retention_days must be between {} and {}",
                TASK_LOG_RETENTION_DAYS_MIN, TASK_LOG_RETENTION_DAYS_MAX
            ));
        }

        let cutoff_at = Utc::now() - Duration::days(retention_days);
        let cutoff_ts = cutoff_at.timestamp();

        let delete_logs = sqlx::query("DELETE FROM task_run_logs WHERE created_at < ?")
            .bind(cutoff_ts)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to purge task run logs: {}", e))?;

        let delete_runs = sqlx::query(
            r#"
            DELETE FROM task_runs
            WHERE finished_at IS NOT NULL
              AND finished_at < ?
              AND id NOT IN (SELECT DISTINCT run_id FROM task_run_logs)
            "#,
        )
        .bind(cutoff_ts)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to purge task runs: {}", e))?;

        let delete_audit_logs = sqlx::query("DELETE FROM task_audit_logs WHERE created_at < ?")
            .bind(cutoff_ts)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to purge task audit logs: {}", e))?;

        Ok(PurgeTaskHistoryResult {
            retention_days,
            cutoff_at,
            deleted_run_logs: delete_logs.rows_affected() as i64,
            deleted_runs: delete_runs.rows_affected() as i64,
            deleted_audit_logs: delete_audit_logs.rows_affected() as i64,
        })
    }

    pub async fn create_composite_step_run(
        &self,
        run_id: &str,
        task_id: &str,
        step_key: &str,
        position: i32,
        status: CompositeStepStatus,
        step_metadata: Value,
    ) -> Result<CompositeStepRun, String> {
        let started_at = Utc::now();
        let finished_at = if status.is_terminal() {
            Some(started_at)
        } else {
            None
        };
        let metadata = normalized_payload(redact_sensitive_json(&step_metadata));
        let metadata_json = serde_json::to_string(&metadata)
            .map_err(|e| format!("Invalid composite step metadata: {}", e))?;

        let row = sqlx::query(
            r#"
            INSERT INTO composite_step_runs (
                run_id, task_id, step_key, position, status, started_at, finished_at, error_message, step_metadata
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            "#,
        )
        .bind(run_id)
        .bind(task_id)
        .bind(step_key.trim())
        .bind(position)
        .bind(status.as_str())
        .bind(started_at.timestamp())
        .bind(finished_at.map(|v| v.timestamp()))
        .bind(Option::<String>::None)
        .bind(metadata_json)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to create composite step run '{}': {}", step_key, e))?;

        let id: i64 = row.try_get("id").map_err(|e| e.to_string())?;
        Ok(CompositeStepRun {
            id,
            run_id: run_id.to_string(),
            task_id: task_id.to_string(),
            step_key: step_key.trim().to_string(),
            position,
            status,
            started_at,
            finished_at,
            error_message: None,
            step_metadata: metadata,
        })
    }

    pub async fn update_composite_step_run_status(
        &self,
        run_id: &str,
        step_key: &str,
        status: CompositeStepStatus,
        error_message: Option<String>,
        step_metadata: Option<Value>,
    ) -> Result<CompositeStepRun, String> {
        let mut step_run = self
            .get_composite_step_run(run_id, step_key)
            .await?
            .ok_or_else(|| {
                format!(
                    "Composite step run not found for run '{}' and step '{}'",
                    run_id, step_key
                )
            })?;

        step_run.status = status;
        step_run.error_message = error_message
            .map(|value| redact_sensitive_text(&value))
            .and_then(trim_to_option);
        if let Some(metadata) = step_metadata {
            step_run.step_metadata = normalized_payload(redact_sensitive_json(&metadata));
        }
        if step_run.status.is_terminal() {
            step_run.finished_at = Some(Utc::now());
        } else if step_run.status == CompositeStepStatus::Running {
            step_run.finished_at = None;
        }

        let metadata_json = serde_json::to_string(&step_run.step_metadata)
            .map_err(|e| format!("Invalid composite step metadata: {}", e))?;

        sqlx::query(
            r#"
            UPDATE composite_step_runs
            SET status = ?, finished_at = ?, error_message = ?, step_metadata = ?
            WHERE run_id = ? AND step_key = ?
            "#,
        )
        .bind(step_run.status.as_str())
        .bind(step_run.finished_at.map(|v| v.timestamp()))
        .bind(&step_run.error_message)
        .bind(metadata_json)
        .bind(run_id)
        .bind(step_key.trim())
        .execute(&self.pool)
        .await
        .map_err(|e| {
            format!(
                "Failed to update composite step run '{}' for run '{}': {}",
                step_key, run_id, e
            )
        })?;

        Ok(step_run)
    }

    pub async fn get_composite_step_run(
        &self,
        run_id: &str,
        step_key: &str,
    ) -> Result<Option<CompositeStepRun>, String> {
        let row = sqlx::query(
            r#"
            SELECT id, run_id, task_id, step_key, position, status, started_at, finished_at, error_message, step_metadata
            FROM composite_step_runs
            WHERE run_id = ? AND step_key = ?
            "#,
        )
        .bind(run_id)
        .bind(step_key.trim())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            format!(
                "Failed to fetch composite step run '{}' for run '{}': {}",
                step_key, run_id, e
            )
        })?;

        match row {
            Some(row) => Ok(Some(Self::row_to_composite_step_run(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn list_composite_step_runs(
        &self,
        run_id: &str,
        limit: i64,
    ) -> Result<Vec<CompositeStepRun>, String> {
        let rows = sqlx::query(
            r#"
            SELECT id, run_id, task_id, step_key, position, status, started_at, finished_at, error_message, step_metadata
            FROM composite_step_runs
            WHERE run_id = ?
            ORDER BY position ASC, id ASC
            LIMIT ?
            "#,
        )
        .bind(run_id)
        .bind(limit.clamp(1, 5000))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to list composite step runs '{}': {}", run_id, e))?;

        rows.iter()
            .map(Self::row_to_composite_step_run)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn get_task_run(&self, run_id: &str) -> Result<Option<TaskRun>, String> {
        let row = sqlx::query(
            r#"
            SELECT id, task_id, trigger_id, status, attempt, started_at, finished_at, error_message, run_metadata
            FROM task_runs
            WHERE id = ?
            "#,
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch task run '{}': {}", run_id, e))?;

        match row {
            Some(row) => Ok(Some(Self::row_to_task_run(&row)?)),
            None => Ok(None),
        }
    }

    async fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let row = sqlx::query("SELECT value FROM task_manager_settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| format!("Failed to fetch task setting '{}': {}", key, e))?;

        match row {
            Some(row) => {
                let value: String = row.try_get("value").map_err(|e| e.to_string())?;
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    async fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let now = Utc::now().timestamp();
        sqlx::query(
            r#"
            INSERT INTO task_manager_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            "#,
        )
        .bind(key)
        .bind(value)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to set task setting '{}': {}", key, e))?;
        Ok(())
    }

    fn row_to_task(row: &sqlx::sqlite::SqliteRow) -> Result<TaskDefinition, String> {
        let payload_str: String = row.try_get("payload").unwrap_or_else(|_| "{}".to_string());
        let tags_str: String = row.try_get("tags").unwrap_or_else(|_| "[]".to_string());

        let payload: Value = serde_json::from_str(&payload_str)
            .map_err(|e| format!("Failed to decode task payload: {}", e))?;
        let tags: Vec<String> = serde_json::from_str(&tags_str)
            .map_err(|e| format!("Failed to decode task tags: {}", e))?;

        let created_at: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let updated_at: i64 = row.try_get("updated_at").map_err(|e| e.to_string())?;
        let last_run_status = row
            .try_get::<Option<String>, _>("last_run_status")
            .ok()
            .flatten()
            .map(|value| RunStatus::from_db(&value))
            .transpose()?;
        let last_run_at = row
            .try_get::<Option<i64>, _>("last_run_at")
            .ok()
            .flatten()
            .map(timestamp_to_datetime);
        let next_run_at = row
            .try_get::<Option<i64>, _>("next_run_at")
            .ok()
            .flatten()
            .map(timestamp_to_datetime);

        Ok(TaskDefinition {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            description: row.try_get("description").map_err(|e| e.to_string())?,
            task_type: TaskType::from_db(
                &row.try_get::<String, _>("task_type")
                    .map_err(|e| e.to_string())?,
            )?,
            status: TaskStatus::from_db(
                &row.try_get::<String, _>("status")
                    .map_err(|e| e.to_string())?,
            )?,
            payload,
            tags,
            owner: row.try_get("owner").map_err(|e| e.to_string())?,
            created_at: timestamp_to_datetime(created_at),
            updated_at: timestamp_to_datetime(updated_at),
            last_run_status,
            last_run_at,
            next_run_at,
        })
    }

    fn row_to_trigger(row: &sqlx::sqlite::SqliteRow) -> Result<TaskTrigger, String> {
        let run_at: Option<i64> = row.try_get("run_at").map_err(|e| e.to_string())?;
        let next_run_at: Option<i64> = row.try_get("next_run_at").map_err(|e| e.to_string())?;
        let last_run_at: Option<i64> = row.try_get("last_run_at").map_err(|e| e.to_string())?;
        let claim_until: Option<i64> = row.try_get("claim_until").map_err(|e| e.to_string())?;
        let created_at: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let updated_at: i64 = row.try_get("updated_at").map_err(|e| e.to_string())?;
        let retry_max_attempts: i64 = row
            .try_get("retry_max_attempts")
            .map_err(|e| e.to_string())?;
        let retry_backoff_ms: i64 = row
            .try_get("retry_backoff_ms")
            .map_err(|e| e.to_string())?;

        Ok(TaskTrigger {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            task_id: row.try_get("task_id").map_err(|e| e.to_string())?,
            trigger_type: TriggerType::from_db(
                &row.try_get::<String, _>("trigger_type")
                    .map_err(|e| e.to_string())?,
            )?,
            cron_expression: row.try_get("cron_expression").map_err(|e| e.to_string())?,
            interval_seconds: row.try_get("interval_seconds").map_err(|e| e.to_string())?,
            run_at: run_at.map(timestamp_to_datetime),
            timezone: row.try_get("timezone").map_err(|e| e.to_string())?,
            misfire_policy: crate::task_manager::models::MisfirePolicy::from_db(
                &row.try_get::<String, _>("misfire_policy")
                    .map_err(|e| e.to_string())?,
            )?,
            retry_policy: crate::task_manager::models::RetryPolicy {
                max_attempts: retry_max_attempts.max(0) as u32,
                backoff_ms: retry_backoff_ms.max(0) as u64,
            },
            enabled: row.try_get::<i32, _>("enabled").map_err(|e| e.to_string())? == 1,
            next_run_at: next_run_at.map(timestamp_to_datetime),
            last_run_at: last_run_at.map(timestamp_to_datetime),
            claim_owner: row.try_get("claim_owner").map_err(|e| e.to_string())?,
            claim_until: claim_until.map(timestamp_to_datetime),
            created_at: timestamp_to_datetime(created_at),
            updated_at: timestamp_to_datetime(updated_at),
        })
    }

    fn row_to_task_run(row: &sqlx::sqlite::SqliteRow) -> Result<TaskRun, String> {
        let metadata_raw: String = row
            .try_get("run_metadata")
            .unwrap_or_else(|_| "{}".to_string());
        let started_at: i64 = row.try_get("started_at").map_err(|e| e.to_string())?;
        let finished_at: Option<i64> = row.try_get("finished_at").map_err(|e| e.to_string())?;

        Ok(TaskRun {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            task_id: row.try_get("task_id").map_err(|e| e.to_string())?,
            trigger_id: row.try_get("trigger_id").map_err(|e| e.to_string())?,
            status: RunStatus::from_db(
                &row.try_get::<String, _>("status")
                    .map_err(|e| e.to_string())?,
            )?,
            attempt: row.try_get("attempt").map_err(|e| e.to_string())?,
            started_at: timestamp_to_datetime(started_at),
            finished_at: finished_at.map(timestamp_to_datetime),
            error_message: row.try_get("error_message").map_err(|e| e.to_string())?,
            run_metadata: serde_json::from_str(&metadata_raw)
                .map_err(|e| format!("Failed to decode run metadata: {}", e))?,
        })
    }

    fn row_to_task_run_log(row: &sqlx::sqlite::SqliteRow) -> Result<TaskRunLog, String> {
        let created_at: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let metadata_raw: String = row
            .try_get("log_metadata")
            .unwrap_or_else(|_| "{}".to_string());

        Ok(TaskRunLog {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            run_id: row.try_get("run_id").map_err(|e| e.to_string())?,
            task_id: row.try_get("task_id").map_err(|e| e.to_string())?,
            level: LogLevel::from_db(
                &row.try_get::<String, _>("level")
                    .map_err(|e| e.to_string())?,
            )?,
            message: row.try_get("message").map_err(|e| e.to_string())?,
            created_at: timestamp_to_datetime(created_at),
            log_metadata: serde_json::from_str(&metadata_raw)
                .map_err(|e| format!("Failed to decode run log metadata: {}", e))?,
        })
    }

    fn row_to_composite_step_run(row: &sqlx::sqlite::SqliteRow) -> Result<CompositeStepRun, String> {
        let metadata_raw: String = row
            .try_get("step_metadata")
            .unwrap_or_else(|_| "{}".to_string());
        let step_metadata = serde_json::from_str(&metadata_raw)
            .map_err(|e| format!("Failed to decode composite step metadata: {}", e))?;

        let started_at: i64 = row.try_get("started_at").map_err(|e| e.to_string())?;
        let finished_at: Option<i64> = row.try_get("finished_at").map_err(|e| e.to_string())?;

        Ok(CompositeStepRun {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            run_id: row.try_get("run_id").map_err(|e| e.to_string())?,
            task_id: row.try_get("task_id").map_err(|e| e.to_string())?,
            step_key: row.try_get("step_key").map_err(|e| e.to_string())?,
            position: row.try_get("position").map_err(|e| e.to_string())?,
            status: CompositeStepStatus::from_db(
                &row.try_get::<String, _>("status")
                    .map_err(|e| e.to_string())?,
            )?,
            started_at: timestamp_to_datetime(started_at),
            finished_at: finished_at.map(timestamp_to_datetime),
            error_message: row.try_get("error_message").map_err(|e| e.to_string())?,
            step_metadata,
        })
    }
}

fn timestamp_to_datetime(ts: i64) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(ts, 0).unwrap_or_else(Utc::now)
}

fn compute_misfire_skip_next_run(
    trigger: &TaskTrigger,
    now: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, String> {
    match trigger.trigger_type {
        TriggerType::OneShot => Ok(None),
        TriggerType::Interval => {
            let seconds = trigger
                .interval_seconds
                .ok_or("interval trigger requires interval_seconds".to_string())?;
            if seconds <= 0 {
                return Err("interval_seconds must be > 0".to_string());
            }
            let base = trigger.next_run_at.unwrap_or(now);
            if base > now {
                return Ok(Some(base));
            }
            let lag_seconds = now.signed_duration_since(base).num_seconds().max(0);
            let steps = lag_seconds / seconds + 1;
            let advanced_seconds = seconds.saturating_mul(steps);
            Ok(Some(base + Duration::seconds(advanced_seconds)))
        }
        TriggerType::Cron => {
            let mut probe = trigger.next_run_at.unwrap_or(now);
            let mut guard = 0usize;
            loop {
                let next = compute_next_after_fire(trigger, probe)?;
                match next {
                    Some(candidate) if candidate <= now => {
                        probe = candidate;
                        guard += 1;
                        if guard > 366 * 24 * 60 {
                            return Ok(None);
                        }
                    }
                    other => return Ok(other),
                }
            }
        }
    }
}

fn compute_misfire_reschedule_next_run(
    trigger: &TaskTrigger,
    now: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, String> {
    match trigger.trigger_type {
        TriggerType::OneShot => Ok(Some(now + Duration::seconds(1))),
        _ => compute_next_after_fire(trigger, now),
    }
}

fn trim_to_option(input: String) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalized_payload(payload: Value) -> Value {
    if payload.is_null() {
        serde_json::json!({})
    } else {
        payload
    }
}

#[cfg(test)]
mod tests {
    use super::{compute_misfire_reschedule_next_run, compute_misfire_skip_next_run, TaskManagerStore};
    use crate::task_manager::models::{
        CreateTaskRequest, CreateTaskTriggerRequest, ListTasksRequest, MisfirePolicy, RetryPolicy,
        RunStatus, TaskStatus, TaskTrigger, TaskType, TriggerType,
    };
    use chrono::{Duration, TimeZone, Utc};
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    fn fixed_ts(y: i32, m: u32, d: u32, hh: u32, mm: u32, ss: u32) -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, hh, mm, ss)
            .single()
            .expect("valid timestamp")
    }

    fn make_trigger(trigger_type: TriggerType) -> TaskTrigger {
        let ts = fixed_ts(2026, 1, 1, 0, 0, 0);
        TaskTrigger {
            id: "trigger-1".to_string(),
            task_id: "task-1".to_string(),
            trigger_type,
            cron_expression: None,
            interval_seconds: None,
            run_at: None,
            timezone: Some("UTC".to_string()),
            misfire_policy: MisfirePolicy::FireNow,
            retry_policy: RetryPolicy {
                max_attempts: 0,
                backoff_ms: 0,
            },
            enabled: true,
            next_run_at: Some(ts),
            last_run_at: None,
            claim_owner: None,
            claim_until: None,
            created_at: ts,
            updated_at: ts,
        }
    }

    #[test]
    fn misfire_skip_interval_advances_to_next_future_slot() {
        let mut trigger = make_trigger(TriggerType::Interval);
        trigger.interval_seconds = Some(60);
        trigger.next_run_at = Some(fixed_ts(2026, 1, 1, 0, 0, 0));

        let now = fixed_ts(2026, 1, 1, 0, 5, 0);
        let next = compute_misfire_skip_next_run(&trigger, now)
            .expect("skip should succeed")
            .expect("next run should exist");

        assert_eq!(next, fixed_ts(2026, 1, 1, 0, 6, 0));
    }

    #[test]
    fn misfire_skip_cron_skips_past_occurrences() {
        let mut trigger = make_trigger(TriggerType::Cron);
        trigger.cron_expression = Some("*/5 * * * *".to_string());
        trigger.next_run_at = Some(fixed_ts(2026, 1, 1, 0, 0, 0));

        let now = fixed_ts(2026, 1, 1, 0, 12, 0);
        let next = compute_misfire_skip_next_run(&trigger, now)
            .expect("skip should succeed")
            .expect("next run should exist");

        assert_eq!(next, fixed_ts(2026, 1, 1, 0, 15, 0));
    }

    #[test]
    fn misfire_reschedule_one_shot_sets_near_future_run() {
        let trigger = make_trigger(TriggerType::OneShot);
        let now = fixed_ts(2026, 1, 1, 3, 0, 0);
        let next = compute_misfire_reschedule_next_run(&trigger, now)
            .expect("reschedule should succeed")
            .expect("next run should exist");
        assert_eq!(next, fixed_ts(2026, 1, 1, 3, 0, 1));
    }

    async fn test_store() -> TaskManagerStore {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("sqlite memory");
        TaskManagerStore::new(pool).await.expect("task store")
    }

    #[tokio::test]
    async fn retention_policy_roundtrip() {
        let store = test_store().await;
        let default_days = store
            .get_task_log_retention_days()
            .await
            .expect("get default retention");
        assert_eq!(default_days, 30);

        let applied = store
            .set_task_log_retention_days(14)
            .await
            .expect("set retention");
        assert_eq!(applied, 14);
        let fetched = store
            .get_task_log_retention_days()
            .await
            .expect("get retention");
        assert_eq!(fetched, 14);
    }

    #[tokio::test]
    async fn purge_old_task_history_deletes_old_rows() {
        let store = test_store().await;
        let task = store
            .create_task(CreateTaskRequest {
                name: "purge-test".to_string(),
                description: Some("retention purge test".to_string()),
                task_type: TaskType::SqlScript,
                status: TaskStatus::Active,
                payload: json!({
                    "sql": "SELECT 1"
                }),
                tags: vec!["test".to_string()],
                owner: Some("tests".to_string()),
            })
            .await
            .expect("create task");

        let run = store
            .create_task_run(
                &task.id,
                None,
                1,
                RunStatus::Queued,
                json!({
                    "origin": "test"
                }),
            )
            .await
            .expect("create run");
        store
            .update_task_run_status(&run.id, RunStatus::Success, None, None)
            .await
            .expect("complete run");
        store
            .append_task_run_log(
                &run.id,
                &task.id,
                crate::task_manager::models::LogLevel::Info,
                "old test log",
                json!({}),
            )
            .await
            .expect("append log");
        store
            .append_task_audit_log(
                "test_event",
                Some(&task.id),
                Some("tests"),
                "old audit log",
                json!({}),
            )
            .await
            .expect("append audit");

        let old_ts = (Utc::now() - Duration::days(45)).timestamp();
        sqlx::query("UPDATE task_run_logs SET created_at = ? WHERE run_id = ?")
            .bind(old_ts)
            .bind(&run.id)
            .execute(&store.pool)
            .await
            .expect("age run logs");
        sqlx::query("UPDATE task_runs SET started_at = ?, finished_at = ? WHERE id = ?")
            .bind(old_ts - 60)
            .bind(old_ts)
            .bind(&run.id)
            .execute(&store.pool)
            .await
            .expect("age run");
        sqlx::query("UPDATE task_audit_logs SET created_at = ?")
            .bind(old_ts)
            .execute(&store.pool)
            .await
            .expect("age audit logs");

        let result = store
            .purge_old_task_history(30)
            .await
            .expect("purge history");
        assert!(result.deleted_run_logs >= 1);
        assert!(result.deleted_runs >= 1);
        assert!(result.deleted_audit_logs >= 1);
    }

    #[tokio::test]
    async fn cancelled_run_status_is_not_overwritten() {
        let store = test_store().await;
        let task = store
            .create_task(CreateTaskRequest {
                name: "cancel-guard".to_string(),
                description: Some("cancel guard test".to_string()),
                task_type: TaskType::SqlScript,
                status: TaskStatus::Active,
                payload: json!({
                    "sql": "SELECT 1"
                }),
                tags: vec!["test".to_string()],
                owner: Some("tests".to_string()),
            })
            .await
            .expect("create task");

        let run = store
            .create_task_run(
                &task.id,
                None,
                1,
                RunStatus::Running,
                json!({
                    "origin": "test"
                }),
            )
            .await
            .expect("create run");

        let cancelled = store
            .update_task_run_status(
                &run.id,
                RunStatus::Cancelled,
                Some("cancelled".to_string()),
                None,
            )
            .await
            .expect("cancel run");
        assert_eq!(cancelled.status, RunStatus::Cancelled);

        let after = store
            .update_task_run_status(&run.id, RunStatus::Success, None, None)
            .await
            .expect("post-cancel update");
        assert_eq!(after.status, RunStatus::Cancelled);
    }

    #[tokio::test]
    async fn list_tasks_includes_last_run_and_next_run_summary() {
        let store = test_store().await;
        let task = store
            .create_task(CreateTaskRequest {
                name: "summary-task".to_string(),
                description: Some("summary fields".to_string()),
                task_type: TaskType::SqlScript,
                status: TaskStatus::Active,
                payload: json!({
                    "sql": "SELECT 1"
                }),
                tags: vec!["summary".to_string()],
                owner: Some("tests".to_string()),
            })
            .await
            .expect("create task");

        let _trigger = store
            .create_trigger(CreateTaskTriggerRequest {
                task_id: task.id.clone(),
                trigger_type: TriggerType::Interval,
                cron_expression: None,
                interval_seconds: Some(60),
                run_at: None,
                timezone: Some("UTC".to_string()),
                misfire_policy: MisfirePolicy::FireNow,
                retry_policy: RetryPolicy::default(),
                enabled: true,
            })
            .await
            .expect("create trigger");

        let run = store
            .create_task_run(&task.id, None, 1, RunStatus::Running, json!({}))
            .await
            .expect("create run");
        let _ = store
            .update_task_run_status(&run.id, RunStatus::Success, None, None)
            .await
            .expect("complete run");

        let listed = store
            .list_tasks(ListTasksRequest::default())
            .await
            .expect("list tasks");
        let listed_task = listed
            .iter()
            .find(|item| item.id == task.id)
            .expect("task in list");

        assert_eq!(listed_task.last_run_status, Some(RunStatus::Success));
        assert!(listed_task.last_run_at.is_some());
        assert!(listed_task.next_run_at.is_some());
    }
}
