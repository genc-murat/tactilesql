<p align="center">
  <img src="public/logo.png" width="200" alt="TactileSQL Logo">
</p>

# TactileSQL

TactileSQL is a modern, desktop-first SQL workbench for MySQL, PostgreSQL, ClickHouse, and MSSQL, built with Tauri 2 and vanilla JavaScript. It provides a rich SQL editing experience, schema tools, and operational dashboards in a fast, native shell.

## Highlights

- **SQL Workbench** with multi-tab editor, syntax highlighting, auto-format, autocomplete, and **code folding**.
- **First-Class MSSQL Support**: Deep integration with SQL Server featuring schema-qualified object browsing, automatic square bracket quoting, and MSSQL-optimized pagination. Includes the **Advanced Server Monitor** (uptime, batch requests, session termination), **Multi-View Visual Execution Plan** (Visual/Diagram, Tree/Hierarchical, and Raw/Source views with Cost/CPU/IO/Rows metrics), **Index Fragmentation & Maintenance** (Rebuild/Reorganize), **SQL Server Agent Job Manager**, and **Storage Visualization** for database files.
- **Native ClickHouse Integration**: High-performance connectivity via native HTTP protocol (port 8123). Features rich SVG **Visual Explain Pipeline**, **Storage Analyzer** (compression & column usage), **Query Profiler** (execution timeline & comparison), **TTL Management** (visual policy editor & impact preview), **Advanced Storage & Part Manager** (partition visualizations & maintenance), **Query Performance Dashboard** (top queries & time-series metrics), **Health Score Dashboard** with 39 metrics across 6 categories (Performance: mark cache, index efficiency, network I/O; Storage: compression, orphaned parts, projections; Maintenance: merges, TTL cleanup, failed merges; Security: passwordless users, excessive grants; Connections: active queries, threads; Query Cost: CPU/memory/IO-intensive queries, full scans, error rate), **System Metrics Dashboard** (real-time resource monitoring), Kafka Monitoring, **Merge & Mutation Monitor**, and **User & Settings Profile Management**.
- **Advanced PostgreSQL Support**: Deep-dive monitoring with the **Server Activity Monitor** (session termination), **Lock Monitor** (visualize blocking chains), and **Extension Management** (install/uninstall extensions).
- **Proactive MySQL Compatibility Initiative**: Comprehensive support for MySQL 5.5 through 8.4+. Features **Intelligent SQL Normalization** (automatically patches breaking syntax like `GROUP BY DESC`), **Version-Aware SQL Snippets**, and **Deep Query Analysis** with proactive `EXPLAIN FORMAT=JSON` selection, cost estimation, and structural insights for Window Functions and CTEs. Extensive monitoring coverage for legacy and modern Performance Schema schemas.
- **Code Folding**: Collapse and expand code blocks (subqueries, CASE/END, BEGIN/END, block comments) for improved readability.
- **Configurable SQL Execution Defaults**: Set default run mode (`current statement` / `selection first` / `run all`) and query timeout (`0 = unlimited`).
- **Smart Autocomplete++** with context-aware suggestions, abbreviation matching (e.g. `tc` → `test_customers`), FK-based JOIN hints, database/schema qualification control, and frequency learning.
- **Intelligent JOIN Statements**: Automatically generate complete JOIN clauses based on foreign key relationships, with automatic alias generation and reverse FK detection.
- **Expand Wildcard**: Replace `SELECT *` or `alias.*` with a comma-separated list of actual column names (`Ctrl+Shift+E`), automatically resolving potential name conflicts.
- **Query Audit Trail** for compliance tracking with exportable logs, statistics, and filtering.
- **Visual Explain** and **Query Profiler** for performance insights across all supported engines.
- **AI Assistant**: SQL generation and natural language query support powered by multiple providers (OpenAI, Gemini, Anthropic, DeepSeek, Groq, Mistral, and Local AI).
- **AI Query Assistance**: Step-by-step query explanation (**Shift+Click Explain**), performance optimization suggestions (**Right-Click Analyze**), and automated error fixing (**Fix with AI**).
- **One-Click Performance Analysis**: Instantly trigger the Query Analyzer for active processes or slow query logs directly from the monitoring dashboard.
- **Index Lifecycle V2**: Detect unused indexes, run drop what-if simulations, compute confidence scores, and generate rollback SQL.
- **SSH Tunnel Support** for secure database connections through SSH servers.
- **Editable Results Grid** with virtual scrolling, column visibility, CSV export, and clipboard copy.
- **Interactive Relational Data Exploration**: Navigate foreign keys directly from results with instant related data popups.
- **Searchable Object Explorer**: Quickly find databases, tables, and columns with "Next/Prev" navigation, auto-expansion, and detailed **Column Tooltips**.
- **Rich Context Menus**: Comprehensive right-click menus for tables, views, and databases with 30+ operations including Export/Import Data, Duplicate Table, Rename Table, Truncate/Drop (with safe confirmation), Table Dependencies, Trigger Manager, Foreign Key Manager, Vacuum/Reindex (PostgreSQL), and Generate SQL templates.
- **Schema Designer** for columns, indexes, foreign keys, triggers, DDL, and stats.
- **Cross-Connection Schema Diff**: Intelligent schema comparison across different host/connection configurations with **Alter Script Generation** and synchronization support.
- **ER Diagram Editor**: Build schema relationship graphs, edit manual relations, and export as JSON/Mermaid/PNG/**GraphML**.
- **Data Transfer/Migration Wizard**: Plan and run DB->DB and DB->file transfers with object-level controls, dry-run support, and run monitoring.
- **Task Center**: End-to-end task orchestration for SQL scripts, backups, snapshots, and migrations with cron/interval triggers and DAG dependency support.
- **Real-time Server Monitor**: Live metrics for CPU, memory, connections, queries, and engine-specific status (InnoDB, ClickHouse Merges, Postgres Locks).
- **MySQL Slow Query Log Runtime Config**: Configure `slow_query_log`, `long_query_time`, and log outputs directly from the UI using `SET GLOBAL`.
- **Themes**: Dark, Light, Oceanic, Dawn, Neon, Ember, and Aurora.

## Tech Stack

- **Frontend**: Vite + Vanilla JS + Tailwind CSS
- **Desktop**: Tauri v2
- **Backend**: Rust + SQLx (MySQL + PostgreSQL) + Tiberius (MSSQL) + Clickhouse-rs (HTTP)
- **State**: LocalStorage + Tauri app data directory + SQLite (Local Store)

## Project Structure

```
index.html
vite.config.js
tailwind.config.js
postcss.config.js
src/
	main.js
	router.js
	index.css
	pages/
	components/
	utils/
src-tauri/
	Cargo.toml
	tauri.conf.json
	src/
```

## Prerequisites

- **Node.js** (LTS recommended)
- **Rust toolchain** (stable)
- **Database Server**: MySQL (5.5+), PostgreSQL (12+), ClickHouse, or SQL Server (2017+)
- **Tauri system dependencies** for your OS (see Tauri v2 docs)

## Setup

Install dependencies:

```
npm install
```

Run the desktop app (Tauri):

```
npx tauri dev
```

Build for production:

```
npx tauri build
```

## Backend Commands (Tauri)

The Rust backend exposes a comprehensive set of commands for cross-database operations:

### Connection Management
- `establish_connection`, `test_connection`, `disconnect`, `get_active_db_type`
- `open_ssh_tunnel`, `close_ssh_tunnel` — Manage SSH local-forward tunnel lifecycle

### Database Schema
- `get_databases`, `get_schemas`, `get_tables`, `get_views`
- `get_table_schema`, `get_table_ddl`, `get_table_stats`
- `get_table_schema_for_config`, `get_table_ddl_for_config` — Fetch metadata for specific configurations (used in Schema Diff)
- `compare_schemas_cross_connection` — Deep-comparison of schemas across different database connections
- `get_table_indexes`, `get_table_foreign_keys`, `get_table_primary_keys`
- `get_procedures`, `get_functions`, `get_triggers`, `get_events`

### Table Operations
- `truncate_table`, `drop_table`, `rename_table`, `duplicate_table` — Safe table lifecycle operations with cross-database support
- `drop_view`, `drop_trigger`, `drop_database`, `create_database` — Object management commands
- `get_table_dependencies` — Foreign key dependency analysis (tables this table depends on and tables that reference it)
- `vacuum_table`, `reindex_table` — PostgreSQL/MySQL maintenance operations

### Monitoring & Performance
- `get_server_status` — Real-time metrics and engine status
- `get_process_list` — Active backend/session monitoring
- `kill_process` — Terminate blocking or runaway sessions
- `get_lock_analysis` — Blocking graphs and deadlock detection
- `get_slow_queries` — Performance samples with AI analysis hooks
- `get_bloat_analysis` — Server-wide fragmentation/waste scanning
- `get_mysql_version` — Detailed version and feature metadata for proactive compatibility
- `normalize_mysql_query` — Translation layer for cross-version SQL syntax normalization

### ClickHouse & MSSQL Specifics
- `get_clickhouse_partitions`, `manage_partition`, `get_clickhouse_parts`, `manage_clickhouse_part`, `get_clickhouse_merges`, `get_clickhouse_mutations`, `get_clickhouse_system_metrics`
- `get_top_queries`, `get_query_metrics_history` — ClickHouse Query Performance analysis and history
- `get_clickhouse_users`, `create_clickhouse_user`, `delete_clickhouse_user`, `get_clickhouse_roles`, `grant_clickhouse_privilege`, `revoke_clickhouse_privilege` — ClickHouse User and Access Control management
- `get_clickhouse_profiles`, `get_clickhouse_profile_details`, `create_clickhouse_profile`, `update_clickhouse_profile`, `delete_clickhouse_profile` — Settings Profile management for ClickHouse workloads
- `get_index_fragmentation`, `maintain_index` — Analyze and optimize MSSQL index performance
- `get_slow_queries` — Performance samples with AI analysis hooks and MSSQL expensive query tracking
- `get_bloat_analysis` — Server-wide fragmentation/waste scanning (MySQL/Postgres) and **Index Fragmentation Analysis** (MSSQL)
- `get_agent_jobs`, `start_agent_job`, `stop_agent_job` — Full SQL Server Agent lifecycle management
- `get_storage_stats` — Detailed file-level storage and space usage analysis for MSSQL databases
- `get_execution_plan` — Capture and parse XML execution plans with dedicated Visual, Tree, and Raw view support
- MSSQL commands utilize the `tiberius` driver for async TDS protocol communication, ensuring robust support for Windows and Linux hosted SQL Servers.

## Keyboard Shortcuts

Common shortcuts (see the in-app help with `F1`):

### Query
- `Ctrl+Enter` / `F5` — Execute selected text or current statement
- `Ctrl+Shift+Enter` — Execute all statements in the editor

### Editor
- `Ctrl+Shift+F` — Format SQL
- `Ctrl+/` — Toggle comment
- `Ctrl+S` — Save as snippet
- `Ctrl+Space` — Autocomplete
- `Ctrl+Shift+E` — Expand wildcard (*)
- `Ctrl+I` — Ask AI Assistant
- `Ctrl+Shift+[` — Fold all regions

### Search & Replace
- `Ctrl+F` — Find in editor
- `Ctrl+H` — Find and Replace in editor
- `F3` / `Shift+F3` — Find Next/Previous Match

### Navigation
- `Ctrl+Shift+O` — Focus Object Explorer
- `Ctrl+Shift+Q` — Focus Query Editor
- `Ctrl+Shift+R` — Focus Results

## Object Explorer Context Menus

Right-click on any object in the Object Explorer to access powerful operations:

### Table Context Menu
- **Data Operations**: Select Top 200, Export Data (CSV/JSON/SQL), Import Data
- **Copy to Clipboard**: Table name, SELECT statement, INSERT template
- **Table Actions**: Duplicate Table, Rename Table, Table Dependencies
- **Maintenance**: Analyze, Check, Optimize, Repair (MySQL), Vacuum/Reindex (PostgreSQL)
- **Management**: Trigger Manager, Foreign Key Manager, Schema Design, Partition Management (MySQL)
- **Generate SQL**: Select, Insert, Update, Delete, Merge, DDL Script
- **Dangerous Operations**: Truncate Table, Drop Table (requires typing table name to confirm)

### View Context Menu
- View Source, Select *, Copy to Clipboard, View Dependencies, Drop View

### Database Context Menu
- **Create New**: Table wizard, View wizard
- **Operations**: Import Data, Properties, Refresh
- **Database-specific**: Storage Visualization (MSSQL), Extensions (PostgreSQL), Vacuum/Analyze/Reindex (PostgreSQL), Check/Optimize All Tables (MySQL)
- **Dangerous Operations**: Drop Database (requires typing database name to confirm)

## Data Storage
- **Connection profiles** are stored in the **Tauri app data directory** as `connections.json`.
- **Local stores and task history** are stored in `<app-data>/storage/local.db` (SQLite, WAL mode).
- **Sensitive data** (passwords and SSH keys) is encrypted at rest using AES-256-GCM.

## Security Features

- **Encrypted Credentials**: All database passwords and SSH credentials are encrypted at rest.
- **SSH Tunnel Support**: Secure connections through SSH bastion hosts.
- **Connection Pooling**: Secure, reusable connection pools.
- **Isolation**: Each database connection maintains its own transaction context and state.

## Troubleshooting

- **No data / errors on dashboards**: Verify an active connection is set in the Connections page.
- **MSSQL Connection issues**: Ensure TCP/IP is enabled in SQL Server Configuration Manager and the port (default 1433) is open.
- **ClickHouse errors**: Check if the HTTP interface is enabled (typically port 8123).

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
