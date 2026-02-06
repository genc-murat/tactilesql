# Task Center Payload Examples

This file provides JSON payload examples for Task Center task types.

## 1) `sql_script`

```json
{
  "sql": "SELECT NOW() AS ts;",
  "timeoutSeconds": 30
}
```

## 2) `backup`

```json
{
  "database": "analytics",
  "includeData": true,
  "filePath": "/tmp/backups/analytics_full.sql"
}
```

## 3) `schema_snapshot`

```json
{
  "connectionId": "conn-prod-mysql",
  "database": "analytics",
  "persistSnapshot": true
}
```

## 4) `data_compare_sync`

```json
{
  "sourceDatabase": "analytics_v1",
  "sourceTable": "orders",
  "targetDatabase": "analytics_v2",
  "targetTable": "orders",
  "keyColumns": ["id"],
  "compareColumns": ["status", "amount", "updated_at"],
  "includeInserts": true,
  "includeUpdates": true,
  "includeDeletes": false,
  "wrapInTransaction": true,
  "statementLimit": 20000,
  "applyScript": false,
  "filePath": "/tmp/sync/orders_sync.sql"
}
```

## 5) `composite` (inline)

```json
{
  "continueOnError": false,
  "failOnAnyError": true,
  "steps": [
    {
      "stepKey": "snapshot_before",
      "taskType": "schema_snapshot",
      "payload": {
        "connectionId": "conn-prod-mysql",
        "database": "analytics",
        "persistSnapshot": true
      }
    },
    {
      "stepKey": "sync_orders",
      "taskType": "data_compare_sync",
      "payload": {
        "sourceDatabase": "analytics_stage",
        "sourceTable": "orders",
        "targetDatabase": "analytics",
        "targetTable": "orders",
        "keyColumns": ["id"],
        "includeInserts": true,
        "includeUpdates": true,
        "includeDeletes": false,
        "applyScript": true
      }
    }
  ],
  "edges": [
    {
      "fromStepKey": "snapshot_before",
      "toStepKey": "sync_orders"
    }
  ]
}
```

## 6) `data_transfer_migration`

```json
{
  "request": {
    "sourceConnectionId": "conn-src-postgres",
    "targetConnectionId": "conn-dst-mysql",
    "sourceDatabase": "sales",
    "targetDatabase": "sales_dw",
    "objects": [
      {
        "sourceTable": "orders",
        "targetTable": "orders",
        "mode": "upsert",
        "keyColumns": ["id"],
        "sinkType": "database"
      },
      {
        "sourceTable": "orders_archive",
        "targetTable": "orders_archive",
        "mode": "append",
        "sinkType": "csv",
        "sinkPath": "/tmp/transfer/orders_archive.csv"
      }
    ],
    "includeSchemaMigration": true,
    "lockGuard": true,
    "mappingProfile": "sales_default"
  },
  "dryRun": false,
  "waitForCompletion": true,
  "timeoutSeconds": 900,
  "pollIntervalMs": 1000
}
```

Behavior notes:

- When `request.includeSchemaMigration` is `true`, preflight schema diff/migration analysis runs before execution.
- When both `request.includeSchemaMigration=true` and `request.lockGuard=true`, the run is blocked if:
  - preflight fails
  - breaking changes are detected
  - migration strategy reports unsupported statements
- Per object `sinkType` defaults to `database` when omitted.
- `sinkPath` is required for `csv`, `jsonl`, and `sql` sink types.
