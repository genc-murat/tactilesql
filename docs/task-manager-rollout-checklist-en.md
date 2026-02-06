# Task Center Rollout and Rollback Checklist

## Release Scope

- Feature: Task Center (`#/tasks`)
- Capability set:
  - task CRUD
  - trigger scheduling
  - composite graph builder and execution
  - run/log inspection
  - scheduler controls
  - retention and audit controls

## Rollout Stages

## Stage 0 - Internal Verification

- `cargo check` is green
- target tests for task manager are green
- `npm run build` is green
- `npm run contract:report` shows zero command mismatch
- no schema migration errors on clean local DB

## Stage 1 - Feature-Flagged Release

- keep `taskCenter` feature flag enabled only for internal users
- verify:
  - `/tasks` route loads correctly
  - nav exposure follows feature flag
  - manual runs emit expected telemetry events
  - audit log rows are created
  - retention policy update and purge command work

## Stage 2 - Limited Pilot

- enable feature for pilot user cohort
- monitor:
  - scheduler throughput and dispatch delay
  - run success/failure ratio
  - event volume (`scheduler_tick`, `task_run_started`, `task_run_finished`)
  - purge operation counters
- collect UI feedback for composite builder usability

## Stage 3 - General Availability

- enable `taskCenter` by default
- keep rollback path ready for one full release cycle
- freeze schema-affecting changes until stabilization window closes

## Go/No-Go Criteria

Go only if:

- no blocking defects in task execution paths
- no command contract drift
- no data loss regression in run/audit persistence
- retention purge works without deleting in-policy records
- telemetry payloads remain redacted

No-Go if:

- repeated scheduler dispatch failures
- command/runtime mismatch in production config
- audit/retention behavior deletes recent required history

## Rollback Plan

## Immediate Mitigation

1. Disable `taskCenter` feature flag.
2. Confirm `/tasks` route is hidden/disabled for users.
3. Keep existing scheduler state unchanged unless incident requires global pause.

## Functional Rollback

1. Pause scheduler if active dispatch is causing impact.
2. Revert application build to previous stable release.
3. Re-run command contract check on rollback branch.
4. Validate existing DB compatibility before re-enabling user traffic.

## Data Safety Checks After Rollback

1. Verify `task_runs`, `task_run_logs`, and `task_audit_logs` row integrity.
2. Verify no unexpected purge occurred during rollback window.
3. Verify retention setting value in `task_manager_settings`.

## Recovery Forward

1. Root-cause the issue.
2. Patch in a hotfix branch with focused tests.
3. Re-run Stage 0 and Stage 1 before re-exposure.

## Operational Notes

- Keep feature flag toggling documented per environment.
- Avoid manual DB edits except incident response with backup and approval.
- Record all rollback actions in incident timeline.
