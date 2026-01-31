# TactileSQL

TactileSQL is a modern, desktop-first MySQL workbench built with Tauri 2 and vanilla JavaScript. It provides a rich SQL editing experience, schema tools, and operational dashboards in a fast, native shell.

## Highlights

- **SQL Workbench** with multi-tab editor, syntax highlighting, auto-format, and autocomplete.
- **Visual Explain** and **Query Profiler** for performance insights.
- **Editable Results Grid** with virtual scrolling, column visibility, CSV export, and clipboard copy.
- **Object Explorer** with databases, tables, views, triggers, procedures, functions, and events.
- **Schema Designer** for columns, indexes, foreign keys, triggers, DDL, and stats.
- **Schema Diff** for database or single-table comparison with generated sync SQL.
- **Connection Manager** with encrypted credential storage and connection testing.
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
- Format SQL and explain plan
- Query execution history and snippet library
- Results grid with filtering, selection, and inline editing

### Dashboard

- KPIs: threads, buffer pool, traffic
- Database size overview
- Active process list

### Schema Designer

- Manage columns, indexes, foreign keys, constraints, triggers
- View DDL and table stats
- SQL draft panel for ALTER statements

### Schema Diff

- Compare source/target databases or single tables
- Generate sync SQL for create/alter/drop

### Connection Manager

- Create, edit, delete, and reorder connections
- Test and establish connection pools

### Access Control

- View MySQL users
- Inspect global and database privileges

### Settings

- Theme selection
- Editor preferences (UI only)

## Backend Commands (Tauri)

The Rust backend exposes the following commands (used by the UI):

- `test_connection`
- `get_connections`, `save_connection`, `save_connections`, `delete_connection`
- `establish_connection`
- `execute_query`
- `get_databases`, `get_tables`, `get_table_schema`
- `get_table_indexes`, `get_table_foreign_keys`, `get_table_primary_keys`, `get_table_constraints`, `get_table_stats`, `get_table_ddl`
- `get_views`, `get_view_definition`, `alter_view`
- `get_triggers`, `get_table_triggers`
- `get_procedures`, `get_functions`, `get_events`
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

- Connection profiles are stored in the **Tauri app data directory** as `connections.json`.
- Passwords are **encrypted** before saving (AES-256-GCM in Rust).

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
