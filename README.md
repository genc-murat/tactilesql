<p align="center">
  <img src="public/logo.png" width="200" alt="TactileSQL Logo">
</p>

<h1 align="center">TactileSQL</h1>

<p align="center">
  <strong>A modern, desktop-first SQL workbench for multiple databases</strong>
</p>

<p align="center">
  <em>Built with Tauri 2 + Rust + Vanilla JavaScript</em>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#tech-stack">Tech Stack</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform">
  <img src="https://img.shields.io/badge/Tauri-v2-24C8D8" alt="Tauri">
  <img src="https://img.shields.io/badge/Rust-Stable-orange" alt="Rust">
  <img src="https://img.shields.io/badge/Node.js-LTS-green" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

---

## Overview

TactileSQL is a powerful, native desktop SQL workbench designed for database developers, DBAs, and data engineers. It provides a rich SQL editing experience, comprehensive schema tools, and operational dashboards in a fast, native shell.

### Supported Databases

| Database | Version | Protocol |
|----------|---------|----------|
| **MySQL** | 5.5 - 8.4+ | Native (SQLx) |
| **PostgreSQL** | 12+ | Native (SQLx) |
| **ClickHouse** | 22.x - 26.x+ | HTTP (8123) |
| **MSSQL** | 2017+ | TDS (Tiberius) |
| **SQLite** | 3.x | File-based |
| **DuckDB** | 1.x | File-based / In-memory |

---

## Features

### 🖥️ SQL Workbench & Editor

- **Multi-Tab Editor** with syntax highlighting and auto-format
- **Code Folding** - Collapse/expand subqueries, CASE/END, BEGIN/END blocks
- **Smart Autocomplete++** - Context-aware suggestions with abbreviation matching (`tc` → `test_customers`)
- **Intelligent JOIN Statements** - Auto-generate JOINs based on foreign key relationships
- **Wildcard Expansion** (`Ctrl+Shift+E`) - Replace `SELECT *` with actual column names
- **Find & Replace** with regex support
- **Snippet Library** - Save and reuse SQL snippets
- **Query Stories** - Version control for your queries with comments and history
- **Named Parameters** - Parameterized queries with default values

### 🗄️ Database Support

#### MySQL
- **Proactive Compatibility** - Automatic SQL normalization for version differences
- **Version-Aware Snippets** - Tailored for MySQL 5.5 through 8.4+
- **Performance Schema** - Deep monitoring coverage for legacy and modern schemas
- **Slow Query Log Config** - Runtime configuration via `SET GLOBAL`
- **InnoDB Status Monitor** - Real-time buffer pool, locks, and transactions

#### PostgreSQL
- **Server Activity Monitor** - Session management with termination support
- **Lock Monitor** - Visualize blocking chains and deadlocks
- **Extension Management** - Install/uninstall extensions
- **Vacuum/Reindex** - Table maintenance operations

#### ClickHouse
- **Native HTTP Protocol** - High-performance connectivity (port 8123)
- **Visual Explain Pipeline** - Rich SVG execution plan visualization
- **Storage Analyzer** - Compression ratios and column usage
- **Health Score Dashboard** - 39 metrics across 6 categories
- **Query Profiler** - Execution timeline and comparison
- **TTL Management** - Visual policy editor with impact preview
- **Projections** - Create, drop, materialize, and manage projections
- **Dictionaries** - Status monitoring and reload
- **Materialized Views** - Full lifecycle management
- **Backup Manager** - Native BACKUP/RESTORE (CH 23.6+)
- **Query Cache Monitor** - Entries, hit ratio, and cache clearing
- **Merge & Mutation Monitor** - Real-time operation tracking

#### MSSQL (SQL Server)
- **Schema-Qualified Browsing** - Full object exploration
- **Visual Execution Plan** - Multi-view (Visual/Tree/Raw) with metrics
- **Index Fragmentation** - Analyze and maintain (Rebuild/Reorganize)
- **SQL Server Agent** - Job management (start/stop/monitor)
- **Storage Visualization** - File-level space usage analysis
- **Advanced Server Monitor** - Uptime, batch requests, sessions

#### SQLite
- **Zero Configuration** - Just point to a `.db` file
- **DDL Inspection** - Via `sqlite_master`
- **PRAGMA Commands** - Index and foreign key management
- **Query Profiling** - Execution statistics

#### DuckDB
- **Flexible Storage** - File-based (`.duckdb`) or in-memory (`:memory:`)
- **Extension Management** - Install and load extensions
- **Information Schema** - Full table browsing
- **Data Import/Export** - Multiple format support

### 🤖 AI Assistant

- **Multiple Providers** - OpenAI, Gemini, Anthropic, DeepSeek, Groq, Mistral, Local AI
- **SQL Generation** - Natural language to SQL queries
- **Query Explanation** - Step-by-step analysis (Shift+Click Explain)
- **Performance Optimization** - AI-powered suggestions
- **Error Fixing** - Automated SQL repair (Fix with AI)
- **Index Recommendations** - AI-analyzed index suggestions

### 📊 Monitoring & Observability

- **Real-time Server Monitor** - CPU, memory, connections, queries
- **Process List** - Active session monitoring with kill support
- **Lock Analysis** - Blocking chains and deadlock detection
- **Slow Query Analysis** - Performance samples with metrics
- **Bloat Analysis** - Fragmentation and waste scanning
- **Capacity Planning** - Growth trends and predictions
- **Health Score** - Database health with actionable recommendations
- **Anomaly Detection** - Automatic baseline comparison
- **Query Comparator** - Before/after performance analysis

### 🔧 DevOps & Automation

- **Task Center** - End-to-end task orchestration
  - SQL scripts, backups, migrations
  - Cron and interval triggers
  - DAG dependency support
  - Dry-run mode
- **Data Transfer Wizard** - DB-to-DB and DB-to-file transfers
  - Object-level controls
  - Progress monitoring
  - Dry-run validation
- **Schema Tracker** - Change capture and migration generation
- **Data Compare** - Row-level comparison with sync scripts
- **Mock Data Generator** - Realistic test data creation

### 🔒 Security & Access Control

- **User Management** - Create, modify, delete users
- **Privilege Management** - Grant/revoke permissions
- **Role Management** - Role hierarchy visualization
- **SSH Tunnel Support** - Secure connections through bastion hosts
- **Encrypted Credentials** - AES-256-GCM encryption at rest
- **Connection Pooling** - Secure, reusable pools

### 🎨 UI/UX Features

- **7 Themes** - Dark, Light, Oceanic, Dawn, Neon, Ember, Aurora
- **Custom Frame** - Native window with custom controls
- **Resizable Panels** - Drag to resize sidebar and editor
- **Virtual Scrolling** - Handle millions of rows efficiently
- **Column Visibility** - Show/hide columns in results grid
- **Object Explorer** - Searchable with column tooltips
- **Context Menus** - 30+ operations per object type
- **Splash Screen** - Elegant loading experience

---

## Screenshots

> **Note**: Add your screenshots here

| SQL Workbench | Schema Designer |
|---------------|-----------------|
| ![Workbench](docs/screenshots/workbench.png) | ![Schema](docs/screenshots/schema.png) |

| Server Monitor | ER Diagram |
|----------------|------------|
| ![Monitor](docs/screenshots/monitor.png) | ![ER](docs/screenshots/er-diagram.png) |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vite + Vanilla JavaScript + Tailwind CSS |
| **Desktop** | Tauri v2 |
| **Backend** | Rust |
| **MySQL** | SQLx (async, native) |
| **PostgreSQL** | SQLx (async, native) |
| **SQLite** | SQLx (async, bundled) |
| **ClickHouse** | clickhouse-rs (HTTP protocol) |
| **MSSQL** | Tiberius (TDS protocol) |
| **DuckDB** | duckdb-rs (bundled) |
| **State** | LocalStorage + SQLite (WAL mode) |
| **Encryption** | AES-256-GCM + OS Keychain |

---

## Project Structure

```
tactileSQL/
├── index.html                 # Main entry point
├── splashscreen.html          # Loading splash screen
├── vite.config.js             # Vite configuration
├── tailwind.config.js         # Tailwind CSS configuration
├── postcss.config.js          # PostCSS configuration
├── package.json               # Node.js dependencies
│
├── src/
│   ├── main.js                # Application entry point
│   ├── router.js              # Client-side routing
│   ├── index.css              # Global styles
│   │
│   ├── pages/                 # Page components (21 pages)
│   │   ├── SqlWorkbench.js    # Main SQL editor
│   │   ├── SchemaDesigner.js  # Table design
│   │   ├── SchemaDiff.js      # Cross-connection diff
│   │   ├── ServerMonitor.js   # Real-time monitoring
│   │   ├── TaskManager.js     # Task orchestration
│   │   ├── DataTools.js       # Import/export/transfer
│   │   ├── ERDiagram.js       # ER visualization
│   │   ├── DataLineage.js     # Data flow tracking
│   │   ├── HealthDashboard.js # Health metrics
│   │   ├── AccessControl.js   # User management
│   │   └── ...                # 10 more pages
│   │
│   ├── components/
│   │   ├── Workbench/         # Query editor, results, object explorer
│   │   ├── UI/                # Reusable UI components
│   │   ├── Layout/            # Header, sidebar, footer
│   │   └── AdvancedInsights/  # Quality, dependency, schema tracker
│   │
│   ├── utils/                 # Utility functions
│   │   ├── AiService.js       # AI provider integrations
│   │   ├── SmartAutocomplete.js
│   │   ├── SqlHighlighter.js
│   │   ├── ThemeManager.js
│   │   └── ...                # More utilities
│   │
│   ├── api/                   # API wrappers
│   │   ├── taskManager.js
│   │   ├── dataTransfer.js
│   │   ├── healthScore.js
│   │   └── ...
│   │
│   ├── database/              # Database adapters
│   │   ├── index.js           # Main adapter
│   │   ├── mysql.js
│   │   ├── postgresql.js
│   │   ├── clickhouse.js
│   │   ├── mssql.js
│   │   └── types.js
│   │
│   └── config/                # Configuration
│       └── featureFlags.js
│
├── src-tauri/                 # Rust backend
│   ├── Cargo.toml             # Rust dependencies
│   ├── tauri.conf.json        # Tauri configuration
│   │
│   └── src/
│       ├── lib.rs             # Main library (540+ commands)
│       ├── main.rs            # Entry point
│       │
│       ├── db/                # Database operations
│       │   ├── connections/   # Connection management
│       │   ├── objects/       # Schema objects
│       │   ├── data_transfer/ # Data transfer engine
│       │   ├── data_compare/  # Data comparison
│       │   └── diagnostics/   # Monitoring
│       │
│       ├── clickhouse/        # ClickHouse-specific
│       ├── mssql/             # MSSQL-specific
│       ├── postgres/          # PostgreSQL-specific
│       ├── mysql/             # MySQL-specific
│       ├── sqlite/            # SQLite-specific
│       ├── duckdb/            # DuckDB-specific
│       │
│       ├── task_manager/      # Task orchestration
│       ├── schema_tracker/    # Schema change tracking
│       ├── quality_analyzer/  # Data quality
│       ├── dependency_engine/ # Object dependencies
│       ├── er_diagram/        # ER generation
│       ├── query_story/       # Query versioning
│       ├── awareness/         # Anomaly detection
│       ├── data_transfer/     # Transfer engine
│       ├── scheduler/         # Cron scheduler
│       └── ssh_tunnel/        # SSH tunneling
│
└── docs/                      # Documentation
    ├── task-manager-technical-guide-en.md
    ├── task-manager-user-guide-en.md
    └── ...
```

---

## Getting Started

### Prerequisites

- **Node.js** (LTS recommended) - [Download](https://nodejs.org/)
- **Rust toolchain** (stable) - [Install](https://rustup.rs/)
- **Database Server**: MySQL, PostgreSQL, ClickHouse, MSSQL, SQLite, or DuckDB
- **Tauri system dependencies** - [See Tauri v2 docs](https://v2.tauri.app/start/prerequisites/)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/tactilesql.git
   cd tactilesql
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run in development mode**
   ```bash
   npx tauri dev
   ```

### Production Build

```bash
npx tauri build
```

Outputs will be in `src-tauri/target/release/bundle/`:
- **Windows**: `.msi` and `.exe`
- **macOS**: `.dmg` and `.app`
- **Linux**: `.deb`, `.rpm`, and `.AppImage`

---

## Documentation

### Backend Commands (Tauri)

The Rust backend exposes **540+ commands** for cross-database operations:

#### Connection Management
```rust
establish_connection, test_connection, disconnect, get_active_db_type
test_ssh_connection, open_ssh_tunnel, close_ssh_tunnel
save_connection, load_connections, delete_connection
```

#### Database Schema
```rust
get_databases, get_schemas, get_tables, get_views
get_table_schema, get_table_ddl, get_table_stats
compare_schemas_cross_connection  // Cross-connection diff
get_table_indexes, get_table_foreign_keys, get_table_primary_keys
get_procedures, get_functions, get_triggers, get_events
```

#### Table Operations
```rust
truncate_table, drop_table, rename_table, duplicate_table
drop_view, drop_trigger, drop_database, create_database
get_table_dependencies  // FK dependency analysis
vacuum_table, reindex_table  // PostgreSQL/MySQL
```

#### Monitoring & Performance
```rust
get_server_status, get_process_list, kill_process
get_lock_analysis, get_slow_queries, get_bloat_analysis
get_execution_plan, compare_queries
get_anomaly_history, get_anomaly_cause
get_capacity_metrics, get_health_score_history
```

#### ClickHouse Specific (40+ commands)
```rust
// Partitions & Storage
get_clickhouse_partitions, manage_partition
get_clickhouse_parts, manage_clickhouse_part
get_clickhouse_merges, get_clickhouse_mutations

// Query Performance
get_top_queries, get_query_metrics_history
get_clickhouse_query_profile, compare_clickhouse_query_profiles
get_clickhouse_query_plan, get_clickhouse_query_history

// User & Access
get_clickhouse_users, create_clickhouse_user, delete_clickhouse_user
get_clickhouse_roles, grant_clickhouse_privilege, revoke_clickhouse_privilege
get_clickhouse_profiles, create_clickhouse_profile, delete_clickhouse_profile

// Caching & Queues
get_clickhouse_query_cache_stats, get_clickhouse_query_cache_entries
clear_clickhouse_query_cache, get_clickhouse_query_queues

// Projections & Views
get_clickhouse_projections, create_clickhouse_projection
drop_clickhouse_projection, materialize_clickhouse_projection
get_clickhouse_materialized_views, refresh_clickhouse_mv

// Dictionaries & Backups
get_clickhouse_dictionaries_detailed, reload_clickhouse_dictionary
get_clickhouse_backups, create_clickhouse_backup, restore_clickhouse_backup
```

#### MSSQL Specific
```rust
get_index_fragmentation, maintain_index  // Rebuild/Reorganize
get_agent_jobs, start_agent_job, stop_agent_job
get_storage_stats  // File-level analysis
get_execution_plan  // XML plan parsing
```

#### Task Manager
```rust
create_task, get_task, list_tasks, update_task, delete_task
create_task_trigger, list_task_triggers, delete_task_trigger
run_task_now, cancel_task_run, retry_task_run
get_task_runs, get_task_run_logs
get_scheduler_state, pause_scheduler, resume_scheduler
upsert_composite_task_graph, get_composite_task_graph
```

### Keyboard Shortcuts

Press `F1` in-app for complete shortcuts.

#### Query Execution
| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` / `F5` | Execute selection or current statement |
| `Ctrl+Shift+Enter` | Execute all statements |

#### Editor
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+F` | Format SQL |
| `Ctrl+/` | Toggle comment |
| `Ctrl+S` | Save as snippet |
| `Ctrl+Space` | Trigger autocomplete |
| `Ctrl+Shift+E` | Expand wildcard (`*`) |
| `Ctrl+I` | Ask AI Assistant |
| `Ctrl+Shift+[` | Fold all regions |

#### Search & Replace
| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Find |
| `Ctrl+H` | Find and Replace |
| `F3` / `Shift+F3` | Find Next/Previous |

#### Navigation
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+O` | Focus Object Explorer |
| `Ctrl+Shift+Q` | Focus Query Editor |
| `Ctrl+Shift+R` | Focus Results |

### Object Explorer Context Menus

#### Table Context Menu
| Category | Operations |
|----------|------------|
| **Data** | Select Top 200, Export (CSV/JSON/SQL), Import |
| **Clipboard** | Copy table name, SELECT, INSERT template |
| **Actions** | Duplicate, Rename, Dependencies |
| **Maintenance** | Analyze, Check, Optimize, Repair, Vacuum, Reindex |
| **Management** | Trigger Manager, FK Manager, Schema Design, Partitions |
| **Generate SQL** | Select, Insert, Update, Delete, Merge, DDL |
| **Destructive** | Truncate, Drop (requires name confirmation) |

#### View Context Menu
- View Source, Select *, Copy to Clipboard
- View Dependencies, Drop View

#### Database Context Menu
- **Create**: Table wizard, View wizard
- **Operations**: Import, Properties, Refresh
- **Engine-specific**: Storage (MSSQL), Extensions (PostgreSQL), Vacuum/Analyze (PostgreSQL)
- **Destructive**: Drop Database (requires name confirmation)

---

## Data Storage

| Data Type | Location | Format |
|-----------|----------|--------|
| **Connection Profiles** | Tauri app data directory | `connections.json` |
| **Local Stores** | `<app-data>/storage/` | SQLite (WAL mode) |
| **Task History** | `<app-data>/storage/local.db` | SQLite |
| **Query Stories** | `<app-data>/storage/local.db` | SQLite |
| **Schema Snapshots** | `<app-data>/storage/local.db` | SQLite |
| **Passwords** | Encrypted in connections.json | AES-256-GCM |
| **SSH Keys** | OS Keychain + encrypted backup | AES-256-GCM |

---

## Security Features

- **Encrypted Credentials** - All passwords and SSH credentials encrypted at rest with AES-256-GCM
- **OS Keychain Integration** - Secure key storage using system keychain
- **SSH Tunnel Support** - Secure connections through SSH bastion hosts
- **Connection Pooling** - Secure, reusable connection pools with isolation
- **Transaction Isolation** - Each connection maintains its own transaction context

---

## Troubleshooting

### General Issues

| Problem | Solution |
|---------|----------|
| **No data on dashboards** | Verify an active connection in Connections page |
| **Connection timeout** | Check firewall rules and database server status |

### Database-Specific

| Database | Issue | Solution |
|----------|-------|----------|
| **MSSQL** | Connection refused | Enable TCP/IP in SQL Server Configuration Manager; verify port 1433 is open |
| **ClickHouse** | HTTP errors | Verify HTTP interface is enabled (port 8123) |
| **ClickHouse** | Feature unavailable | Check version compatibility (Query Cache: CH 22+, Backup: CH 23.6+) |
| **SQLite** | File errors | Ensure file exists with read/write permissions |
| **DuckDB** | Permission denied | Check file permissions; use `:memory:` for temporary databases |
| **MySQL** | Syntax errors on older versions | Enable SQL normalization in settings |

---

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

---

## License

This project is licensed under the MIT License.
