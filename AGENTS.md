# AGENTS.md — TactileSQL

## Project Overview

TactileSQL is a desktop-first SQL workbench for multiple databases, built with **Tauri v2 + Rust backend + Vanilla JavaScript frontend**. It supports MySQL, PostgreSQL, ClickHouse, MSSQL, and SQLite.

## Build Commands

```bash
# Install dependencies
npm install

# Frontend dev server only
npm run dev

# Frontend production build
npm run build

# Full Tauri development (frontend + Rust)
npx tauri dev

# Full Tauri production build
npx tauri build
```

## Test & Lint Commands

```bash
# Rust backend tests
cargo test --manifest-path src-tauri/Cargo.toml

# Rust compilation check (fast)
cargo check --manifest-path src-tauri/Cargo.toml

# Frontend-backend command contract check
npm run contract:check

# Update command contract snapshot
npm run contract:report -- --write
```

## Project Structure

```
tactileSQL/
├── src/                    # Frontend (Vanilla JS + Tailwind CSS)
│   ├── main.js             # Entry point, routing, window management
│   ├── router.js           # Hash-based client-side router
│   ├── pages/              # 21 page components (lazy-loaded)
│   ├── components/         # UI components (Workbench, UI, Layout, etc.)
│   ├── utils/              # Utilities (ThemeManager, AiService, etc.)
│   ├── api/                # Tauri invoke wrappers
│   ├── database/           # DB adapters and SQL definitions
│   ├── config/             # Feature flags
│   └── constants/          # Settings keys and defaults
├── src-tauri/              # Rust backend (Tauri v2)
│   ├── src/
│   │   ├── lib.rs          # Main library (~200 Tauri commands)
│   │   ├── db/             # Core DB operations (query, metadata, diagnostics)
│   │   ├── mysql/          # MySQL-specific operations
│   │   ├── postgres/       # PostgreSQL-specific operations
│   │   ├── clickhouse/     # ClickHouse-specific operations
│   │   ├── mssql/          # MSSQL-specific operations
│   │   ├── sqlite/         # SQLite-specific operations
│   │   ├── task_manager/   # Task orchestration & scheduling
│   │   ├── schema_tracker/ # Schema change tracking & migration
│   │   ├── awareness/      # Anomaly detection & query profiling
│   │   ├── dependency_engine/ # SQL dependency graph
│   │   ├── er_diagram/     # ER diagram generation
│   │   ├── quality_analyzer/ # Data quality analysis
│   │   ├── query_story/    # Query versioning
│   │   ├── data_transfer/  # DB-to-DB transfer engine
│   │   ├── scheduler/      # Cron-based job scheduler
│   │   └── ssh_tunnel/     # SSH tunnel support
│   └── Cargo.toml
├── docs/                   # Documentation
└── dist/                   # Build output
```

## Code Style

### JavaScript (Frontend)
- Vanilla ES modules (`import`/`export`), no framework
- Tailwind CSS for styling (no CSS-in-JS)
- Theme-aware classes via `ThemeManager` utility
- Snippet placeholders use `${1:default}` syntax in single-quoted strings (NOT backtick template literals)
- Lazy-loaded pages via `lazyLoad()` helper in `main.js`

### Rust (Backend)
- Edition 2021
- Tauri commands annotated with `#[tauri::command]`
- State managed via `tauri::manage()` with `AppState`
- All DB operations are async (tokio runtime)
- Tests use SQLite in-memory for storage layer

## Architecture Notes

- **Routing**: Hash-based (`#/workbench`, `#/schema`, etc.) via custom `Router` class
- **DB Connections**: Managed in Rust `AppState` with separate connection pools per DB type
- **Encryption**: AES-256-GCM for stored credentials, OS keychain integration
- **Local Storage**: SQLite (WAL mode) for task history, query stories, schema snapshots, etc.
- **Feature Flags**: `src/config/featureFlags.js` — currently only `taskCenter`
- **Command Contract**: `src/generated/command-contract.json` tracks frontend-backend command alignment

