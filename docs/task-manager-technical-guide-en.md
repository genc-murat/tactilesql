# Task Center Technical Guide

## Scope

This document describes backend and frontend architecture for Task Center features:

- Task management
- Scheduler runtime
- Composite orchestration
- Telemetry events
- Audit logging and retention policy

## Backend Modules

- `src-tauri/src/task_manager/models.rs`
  - domain models, validation, retry/misfire/composite graph contracts
- `src-tauri/src/task_manager/storage.rs`
  - SQLite schema, CRUD, run/log persistence, composite graph persistence
  - audit log persistence
  - retention policy read/write + purge routines
- `src-tauri/src/task_manager/executor.rs`
  - task execution by task type
  - composite execution, step state transitions, dry-run behavior
- `src-tauri/src/task_manager/commands.rs`
  - Tauri command layer
  - manual run lifecycle (`prepare` + `finalize`) and command-oriented tests
- `src-tauri/src/scheduler.rs`
  - scheduler loop, trigger claim/dispatch, retry/misfire behavior
  - telemetry emission and scheduled retention purge hook
- `src-tauri/src/task_manager/security.rs`
  - sensitive text and JSON redaction utilities

## Frontend Modules

- `src/pages/TaskManager.js`
  - Task Center page
  - composite builder, scheduler controls, retention controls
- `src/api/taskManager.js`
  - invoke wrappers for task manager commands
- `src/config/featureFlags.js`
  - runtime feature flag control (`taskCenter`)
- `src/main.js`, `src/components/Layout/NavBar.js`
  - feature-gated route/nav exposure

## Tauri Commands

Core commands include:

- Task CRUD and listing:
  - `create_task`, `get_task`, `list_tasks`, `update_task`, `delete_task`
- Trigger management:
  - `create_task_trigger`, `get_task_trigger`, `list_task_triggers`, `update_task_trigger`, `delete_task_trigger`
- Run/log APIs:
  - `run_task_now`, `get_task_runs`, `get_task_run_logs`, `get_composite_step_runs`
- Composite graph APIs:
  - `upsert_composite_task_graph`, `get_composite_task_graph`
- Scheduler state APIs:
  - `get_scheduler_state`, `set_scheduler_state`, `pause_scheduler`, `resume_scheduler`, `disable_scheduler`
- Audit and retention APIs:
  - `list_task_audit_logs`
  - `get_task_log_retention_policy`
  - `set_task_log_retention_policy`
  - `purge_task_history`

## Data Model (SQLite)

Primary tables:

- `tasks`
- `task_triggers`
- `task_runs`
- `task_run_logs`
- `composite_tasks`
- `composite_steps`
- `composite_edges`
- `composite_step_runs`
- `task_manager_settings`
- `task_audit_logs`

Retention setting key:

- `task_run_log_retention_days`

## Telemetry and Event Contracts

Emitted events:

- `scheduler_tick`
  - `schedulerId`, `state`, `claimedTriggers`, `tickedAt`
- `task_run_started`
  - `runId`, `taskId`, `origin`, `attempt`, `totalAttempts`, `startedAt`
- `task_run_finished`
  - `runId`, `taskId`, `origin`, `status`, `attempt`, `finishedAt`, `durationMs`, optional redacted `error`
- `task_history_purged`
  - `schedulerId`, `retentionDays`, `cutoffAt`, delete counters, `triggeredAt`

PII/secret handling:

- textual messages pass through `redact_sensitive_text`
- metadata payloads pass through `redact_sensitive_json`

## Test Coverage Summary

Unit and integration-oriented tests cover:

- composite cycle validation
- misfire skip/reschedule behavior
- retry backoff helper
- command-oriented manual run success/failure/not-found paths
- retention policy roundtrip
- purge behavior for old run logs/runs/audit logs

Command layer tests use in-memory SQLite for command -> storage -> finalize flow checks.
