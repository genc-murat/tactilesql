# Task Center User Guide

## Overview

Task Center is the operational workspace for task creation, scheduling, composite orchestration, and run inspection in TactileSQL.

- Route: `#/tasks`
- Availability: controlled by feature flag `taskCenter`

## Create a Task

1. Open `Task Center`.
2. Fill in `Task name` and optional metadata (`description`, `owner`, `tags`).
3. Select `Task type`:
   - `SQL Script`
   - `Backup`
   - `Schema Snapshot`
   - `Data Compare + Sync`
   - `Composite`
4. Provide a valid JSON payload in `Payload`.
5. Click `Create Task`.

Payload examples:
- `docs/dbeaver-task-manager-payload-examples.md`

## Configure Triggers

1. Select an existing task from the task list.
2. In `Triggers`, choose `Trigger type`:
   - `interval`
   - `cron`
   - `one_shot`
3. Configure:
   - retry (`maxAttempts`, `backoffMs`)
   - misfire policy (`fire_now`, `skip`, `reschedule`)
4. Click `Add Trigger`.

## Composite Builder

For `Composite` tasks, the `Composite Builder` panel is available.

- Step operations:
  - `Add Step`
  - move with `Up` / `Down`
  - remove with `Delete`
- Dependency operations:
  - `Add Dependency`
  - set `From -> To`
  - remove with `Delete`
- Save behavior:
  - `Save Graph` is disabled when validation fails
  - cycle and invalid dependency checks run client-side before save

## Run and Log Inspection

- Click `Run Now` for immediate manual execution.
- In `Runs & Logs`:
  - select a run to view logs
  - view composite step statuses for composite runs

## Scheduler Controls

Use the header controls to set global scheduler state:

- `Running`
- `Pause`
- `Disable`

## Retention and Purge

Retention controls are available in the header:

- set retention days and click `Apply`
- click `Purge` to remove old history beyond policy

Purged scope:

- `task_run_logs`
- completed `task_runs` not referenced by remaining logs
- `task_audit_logs`

## Emitted Events

Task Center and scheduler emit:

- `scheduler_tick`
- `task_run_started`
- `task_run_finished`
- `task_history_purged`

Event payloads are sanitized for sensitive fields.
