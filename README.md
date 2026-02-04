# TactileSQL

TactileSQL is a modern, desktop-first MySQL workbench built with Tauri 2 and vanilla JavaScript. It provides a rich SQL editing experience, schema tools, and operational dashboards in a fast, native shell.

## Highlights

- **SQL Workbench** with multi-tab editor, syntax highlighting, auto-format, and autocomplete.
- **Smart Autocomplete++** with context-aware suggestions, FK-based JOIN hints, and frequency learning.
- **Query Audit Trail** for compliance tracking with exportable logs, statistics, and filtering.
- **Visual Explain** and **Query Profiler** for performance insights.
- **AI Assistant**: SQL generation and natural language query support powered by multiple providers (OpenAI, Gemini, Anthropic, DeepSeek, Groq, Mistral, and Local AI).
- **AI Query Assistance**: Step-by-step query explanation (**Shift+Click Explain**), performance optimization suggestions (**Right-Click Analyze**), and automated error fixing (**Fix with AI**).
- **AI Query Profiler Analysis**: One-click AI interpretation of query performance metrics with actionable optimization advice.
- **Latency prediction & slow-query early warning** based on historical execution patterns.
- **Parameter suggestions** using historical value distributions.
- **What‑If Optimizer** to compare query variants with estimated cost.
- **Similarity & workload profiling** to group duplicate query patterns.
- **SSH Tunnel Support** for secure database connections through SSH servers.
- **Editable Results Grid** with virtual scrolling, column visibility, CSV export, and clipboard copy.
- **Interactive Relational Data Exploration**: Navigate foreign keys directly from results with instant related data popups.
- **Object Explorer** with search functionality, databases, tables, views, triggers, procedures, functions, and events.
- **Searchable Object Explorer**: Integrated search box to quickly find databases, tables, and columns with "Next/Prev" navigation and auto-expansion.
- **Schema Designer** for columns, indexes, foreign keys, triggers, DDL, and stats.
- **Schema Diff** for database or single-table comparison with generated sync SQL.
- **Data Import/Export Wizard** supporting CSV, SQL, and JSON formats with progress tracking.
- **Backup & Restore** with scheduled backups, compression, and full/incremental backup modes.
- **Real-time Server Monitor** with live metrics for CPU, memory, connections, queries, and InnoDB status.
- **Schema Evolution Tracker**: Capture snapshots, detect drifts, and auto-generate migration scripts.
- **Data Quality Analyzer**: Track data health scores, detect anomalies (NULLs, duplicates), and visualize quality trends.
- **Dependency Engine**: Visualize lineage between tables, views, and procedures with impact analysis for schema changes.
- **Connection Manager** with encrypted credential storage, connection testing, and SSH tunnel configuration.
- **Access Control** viewer for MySQL users and privileges.
- **Themes**: Dark, Light, and Oceanic.
- **Global keyboard shortcuts** and shortcut help overlay.

## Tech Stack

- **Frontend**: Vite + Vanilla JS + Tailwind CSS
- **Desktop**: Tauri v2
- **Backend**: Rust + SQLx (MySQL)
- **State**: LocalStorage + Tauri app data directory

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
- **MySQL server** accessible from your machine
- **Tauri system dependencies** for your OS (see Tauri v2 docs)
- **SSH access** (optional) for remote database connections via SSH tunnel

## Setup

Install dependencies:

```
npm install
```

Run the web UI only (Vite):

```
npm run dev
```

Run the desktop app (Tauri):

```
npx tauri dev
```

Build for production:

```
npm run build
npx tauri build
```

## Core Screens

### Workbench

- Multi-tab SQL editor with autocomplete and syntax highlighting
- **AI Assistant (Ctrl+I)**: Generate SQL from natural language or edit existing queries.
- **AI Profiler Analysis**: Interpretation of performance metrics (Tmp tables, lock waits, etc.) with AI-driven recommendations.
- Format SQL and explain plan with visual query analyzer
- Query optimization suggestions with index recommendations and index impact estimates
- Slow query early warning and latency estimates
- Parameter suggestions based on history
- What‑If Optimizer for variant comparisons
- Query execution history and snippet library
- Results grid with filtering, selection, and inline editing
- **Results Explorer**: Ctrl+Click on foreign keys to view referenced related data in popup
- **Object Explorer Search**: Quickly jump to any database, table, or column with a persistent search box, match navigation, and auto-expanding tree.

### Audit Trail

- Similar/duplicate query detection
- Workload profiling with auto-labeling (hot/slow/error-prone)

### Awareness Features

- **Query Comparator**: Visual diff of two queries with syntax highlighting and performance metric comparison (execution time, rows affected, etc.).
- **Anomaly Dashboard**: Detects and displays performance regressions by comparing current execution against historical baselines.
- **Performance Profiler**: Backend service that tracks query execution history and builds baseline profiles for anomaly detection.

### Dashboard

- KPIs: threads, buffer pool, traffic
- Database size overview
- Active process list

### Data Tools

- **Import Wizard**: Upload CSV, SQL, or JSON files with field mapping and preview
- **Export Tool**: Export databases or tables to CSV, SQL, or JSON formats
- **Backup Manager**: Schedule automated backups with compression and encryption
- **Restore Database**: Restore from previous backups with validation

### Server Monitor

- **Real-time Metrics**: Live CPU, memory, and disk usage monitoring
- **Connection Stats**: Active connections, threads running, and connection pool status
- **Query Performance**: Queries per second, slow query tracking, and execution stats
- **InnoDB Status**: Buffer pool, transaction logs, and storage engine metrics
- **Auto-refresh**: Configurable refresh intervals (1s, 5s, 10s, 30s, 60s)

### Schema Designer

- Manage columns, indexes, foreign keys, constraints, triggers
- View DDL and table stats
- SQL draft panel for ALTER statements

### Schema Diff

- Compare source/target databases or single tables
- Generate sync SQL for create/alter/drop

### Connection Manager

- Create, edit, delete, and reorder connections
- SSH Tunnel configuration for secure remote access
- Test and establish connection pools
- Color-coded connection groups

### Access Control

- View MySQL users
- Inspect global and database privileges

### Settings

- Theme selection
- Editor preferences (UI only)

## Advanced Insights

### Schema Evolution Tracker
- **Snapshots**: Capture database state at any point in time.
- **Diff Viewer**: Visual comparison between snapshots showing added/dropped/modified tables and columns.
- **Migration Generation**: Automatically generates SQL scripts to migrate between versions.
- **Breaking Change Detection**: Alerts on destructive changes (drops, type changes).

### Data Quality Analyzer
- **Health Score**: 0-100 score based on NULL rates, duplicates, and constraints.
- **Issue Tracking**: Detailed list of quality violations per table.
- **Timeline Integration**: View quality scores historically alongside schema changes.

### Dependency Engine
- **Visual Graph**: Interactive node-link diagram of database dependencies.
- **Impact Analysis**: Identify downstream objects affected by a proposed change.
- **Quality Overlay**: Color-coded graph nodes based on data quality scores.
- **Mermaid Export**: Export the dependency graph as a mermaid diagram for external documentation.

## Backend Commands (Tauri)

The Rust backend exposes the following commands (used by the UI):

### Connection Management
- `test_connection`, `establish_connection`
- `get_connections`, `save_connection`, `save_connections`, `delete_connection`
- `create_ssh_tunnel` — Establish SSH tunnel for remote database access

### Query Execution
- `execute_query` — Execute SQL statements
- `analyze_query` — Analyze query performance and get optimization suggestions

### Awareness Features
- `compare_queries` — Compare syntax and performance of two queries
- `get_anomaly_history` — Retrieve history of detected performance anomalies
- `get_query_history` — Retrieve execution history for specific queries

### Database Schema
- `get_databases`, `get_tables`, `get_table_schema`
- `get_table_indexes`, `get_table_foreign_keys`, `get_table_primary_keys`, `get_table_constraints`, `get_table_stats`, `get_table_ddl`
- `get_views`, `get_view_definition`, `alter_view`
- `get_triggers`, `get_table_triggers`
- `get_procedures`, `get_functions`, `get_events`

### Data Tools
- `import_csv` — Import CSV files with field mapping
- `import_sql` — Execute SQL dump files
- `import_json` — Import JSON data with schema inference
- `export_data` — Export to CSV, SQL, or JSON formats
- `create_backup` — Create database backups with compression
- `restore_backup` — Restore from backup files
- `list_backups` — List available backup files
- `schedule_backup` — Schedule automated backups

### Monitoring
- `get_server_metrics` — Real-time CPU, memory, and connection stats
- `get_query_stats` — Query performance metrics
- `get_innodb_status` — InnoDB storage engine status

### User Management
- `get_mysql_users`, `get_user_privileges`

## Keyboard Shortcuts

Common shortcuts (see the in-app help with `F1`):

### Query
- `Ctrl+Enter` / `F5` — Execute query

### Tabs
- `Ctrl+N` — New tab
- `Ctrl+W` — Close tab
- `Ctrl+Tab` / `Ctrl+Shift+Tab` — Next/previous tab
- `Ctrl+1` … `Ctrl+5` — Jump to tab

### Editor
- `Ctrl+Shift+F` — Format SQL
- `Ctrl+/` — Toggle comment
- `Ctrl+S` — Save as snippet
- `Ctrl+Space` — Autocomplete
- `Ctrl+I` — Ask AI Assistant

### Navigation
- `Ctrl+Shift+E` — Focus Object Explorer
- `Ctrl+Shift+Q` — Focus Query Editor
- `Ctrl+Shift+R` — Focus Results
- `Ctrl+Shift+S` — Focus Snippets

### Tools
- `Ctrl+Shift+P` — Toggle Query Profiler

### General
- `F1` — Shortcut help
- `Esc` — Close active modal

## Data Storage
**Connection profiles** are stored in the **Tauri app data directory** as `connections.json`.
- **Backup files** are stored in `<app-data>/backups/` directory.
- **SSH keys** and credentials are encrypted with AES-256-GCM.
- **Passwords** are encrypted before saving (AES-256-GCM in Rust).

> Note: The encryption key is currently a static constant in [src-tauri/src/db.rs](src-tauri/src/db.rs). For production use, replace this with a key derived from the OS keychain or a user-provided secret.

## Security Features

- **Encrypted Credentials**: All database passwords and SSH credentials are encrypted at rest
- **SSH Tunnel Support**: Secure connections through SSH bastion hosts
- **Key-based Authentication**: Support for SSH private key authentication
- **Connection Pooling**: Secure, reusable connection pools
- **Backup Encryption**: Optional encryption for database backups
> Note: The encryption key is currently a static constant in [src-tauri/src/db.rs](src-tauri/src/db.rs). For production use, replace this with a key derived from the OS keychain or a user-provided secret.

## Window Behavior

- Frameless window with custom title bar and window controls.
- Minimum window size: **1280 × 800**.
- Custom resize handles (native resizing disabled).

## Troubleshooting

- **No data / errors on dashboards**: verify an active connection is set in the Connections page.
- **Connection refused**: ensure MySQL is running and reachable at host/port.
- **Tauri build issues**: verify system dependencies from Tauri v2 documentation.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
