// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use regex::Regex;
use tauri::Manager;
use tauri::WebviewWindow;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_devtools(webview: WebviewWindow) {
    webview.open_devtools();
}

#[tauri::command]
fn close_devtools(webview: WebviewWindow) {
    webview.close_devtools();
}

#[tauri::command]
fn is_devtools_open(webview: WebviewWindow) -> bool {
    webview.is_devtools_open()
}

#[tauri::command]
async fn close_splashscreen(window: WebviewWindow) {
    if let Some(splash_window) = window.get_webview_window("splashscreen") {
        splash_window.close().unwrap();
    }
    if let Some(main_window) = window.get_webview_window("main") {
        main_window.show().unwrap();
        main_window.set_focus().unwrap();
    }
}

#[tauri::command]
fn get_registered_commands() -> Result<Vec<String>, String> {
    let source = include_str!("lib.rs");
    let block_re = Regex::new(r"(?s)generate_handler!\[(?P<body>.*?)\]")
        .map_err(|e| format!("Regex init failed: {}", e))?;
    let body = block_re
        .captures(source)
        .and_then(|caps| caps.name("body"))
        .map(|m| m.as_str())
        .ok_or("Failed to locate generate_handler block".to_string())?;

    let command_re = Regex::new(r"(?m)^\s*([a-zA-Z_][a-zA-Z0-9_:]*)\s*,")
        .map_err(|e| format!("Regex init failed: {}", e))?;

    let mut commands: Vec<String> = command_re
        .captures_iter(body)
        .filter_map(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        .map(|path| path.rsplit("::").next().unwrap_or(&path).to_string())
        .collect();

    commands.sort();
    commands.dedup();
    Ok(commands)
}

// Database modules
pub mod awareness;
pub mod chronicle;
mod common;
pub mod data_transfer;
mod db;
mod db_types;
pub mod dependency_engine;
pub mod er_diagram;
pub mod impact_analyzer;
pub mod integration;
pub mod mock_data;
pub mod mysql;
pub mod postgres;
pub mod clickhouse;
pub mod mssql;
pub mod quality_analyzer;
pub mod query_story;
pub mod scheduler;
pub mod schema_tracker;
pub mod task_manager;
mod ssh_tunnel;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(db::AppState::default())
        .setup(|app| {
            // Get all webview windows and set size constraints
            use tauri::LogicalSize;
            println!("Setting up windows...");
            for (label, window) in app.webview_windows() {
                // Skip splash screen from min size enforcement
                if label == "splashscreen" {
                    continue;
                }
                println!("Found window with label: {}", label);
                match window.set_min_size(Some(LogicalSize::new(1280.0, 800.0))) {
                    Ok(_) => println!("Successfully set min size for window: {}", label),
                    Err(e) => println!("Error setting min size: {}", e),
                }
            }

            // Initialize Encryption Key
            let app_handle = app.handle();
            let state = app.state::<db::AppState>();
            match db::initialize_key(app_handle, db::get_connections_file_path) {
                Ok(key) => {
                    let mut guard = futures::executor::block_on(state.encryption_key.lock());
                    *guard = Some(key);
                    println!(
                        "Encryption key initialized successfully (from Keychain or Migration)."
                    );
                }
                Err(e) => {
                    eprintln!("CRITICAL ERROR: Failed to initialize encryption key: {}", e);
                    // We might want to show a dialog here or panic, but for now log it.
                    // Without key, load_connections and save_connection will fail.
                }
            }

            // Initialize Local Storage & Stores
            let app_handle_clone = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match crate::common::storage::init_local_db(&app_handle_clone).await {
                    Ok(pool) => {
                        let state = app_handle_clone.state::<db::AppState>();
                        {
                            let mut pool_guard = state.local_db_pool.lock().await;
                            *pool_guard = Some(pool.clone());
                        }
                        println!("Local Storage initialized successfully.");

                        // Data Transfer Store
                        match crate::data_transfer::storage::set_local_pool(pool.clone()).await {
                            Ok(_) => println!("Data Transfer Store initialized."),
                            Err(e) => eprintln!("Failed to init Data Transfer Store: {}", e),
                        }

                        // Task Manager Store
                        match crate::task_manager::storage::TaskManagerStore::new(pool.clone())
                            .await
                        {
                            Ok(store) => {
                                let mut guard = state.task_manager_store.lock().await;
                                *guard = Some(store);
                                println!("Task Manager Store initialized.");
                            }
                            Err(e) => eprintln!("Failed to init Task Manager Store: {}", e),
                        }

                        // Awareness Store
                        match crate::awareness::store::AwarenessStore::new(pool.clone()).await {
                            Ok(store) => {
                                let mut guard = state.awareness_store.lock().await;
                                *guard = Some(store);
                                println!("Awareness Store initialized.");
                            }
                            Err(e) => eprintln!("Failed to init Awareness Store: {}", e),
                        }

                        // Schema Tracker Store
                        match crate::schema_tracker::storage::SchemaTrackerStore::new(pool.clone())
                            .await
                        {
                            Ok(store) => {
                                let mut guard = state.schema_tracker_store.lock().await;
                                *guard = Some(store);
                                println!("Schema Tracker Store initialized.");
                            }
                            Err(e) => eprintln!("Failed to init Schema Tracker Store: {}", e),
                        }

                        // Quality Analyzer Store
                        match crate::quality_analyzer::storage::QualityAnalyzerStore::new(
                            pool.clone(),
                        )
                        .await
                        {
                            Ok(store) => {
                                let mut guard = state.quality_analyzer_store.lock().await;
                                *guard = Some(store);
                                println!("Quality Analyzer Store initialized.");
                            }
                            Err(e) => eprintln!("Failed to init Quality Analyzer Store: {}", e),
                        }

                        // Dependency Engine Store
                        match crate::dependency_engine::storage::DependencyEngineStore::new(
                            pool.clone(),
                        )
                        .await
                        {
                            Ok(store) => {
                                let mut guard = state.dependency_engine_store.lock().await;
                                *guard = Some(store);
                                println!("Dependency Engine Store initialized.");
                            }
                            Err(e) => eprintln!("Failed to init Dependency Engine Store: {}", e),
                        }

                        // ER Diagram Store
                        match crate::er_diagram::storage::ErDiagramStore::new(pool.clone()).await {
                            Ok(store) => {
                                let mut guard = state.er_diagram_store.lock().await;
                                *guard = Some(store);
                                println!("ER Diagram Store initialized.");
                            }
                            Err(e) => eprintln!("Failed to init ER Diagram Store: {}", e),
                        }

                        // Query Story Store
                        match crate::query_story::storage::QueryStoryStore::new(pool.clone()).await
                        {
                            Ok(store) => {
                                let mut guard = state.query_story_store.lock().await;
                                *guard = Some(store);
                                println!("Query Story Store initialized.");
                            }
                            Err(e) => eprintln!("Failed to init Query Story Store: {}", e),
                        }

                        // Monitor Store
                        match crate::db::diagnostics::monitor_store::MonitorStore::new(pool.clone())
                            .await
                        {
                            Ok(store) => {
                                let mut guard = state.monitor_store.lock().await;
                                *guard = Some(store);
                                println!("Monitor Store initialized.");
                            }
                            Err(e) => eprintln!("Failed to init Monitor Store: {}", e),
                        }

                    }
                    Err(e) => eprintln!("Failed to initialize Local Storage: {}", e),
                }
            });

            // Start Scheduler
            let scheduler_handle = app.handle().clone();
            crate::scheduler::start_scheduler(scheduler_handle);

            // Start Monitoring Worker
            let monitor_handle = app.handle().clone();
            crate::db::diagnostics::worker::start_monitoring_worker(monitor_handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            close_splashscreen,
            // DevTools
            open_devtools,
            close_devtools,
            is_devtools_open,
            get_registered_commands,
            // Connection Management
            db::test_connection,
            db::test_ssh_connection,
            db::open_ssh_tunnel,
            db::close_ssh_tunnel,
            db::establish_connection,
            db::disconnect,
            db::get_active_db_type,
            db::save_connection,
            db::load_connections,
            db::delete_connection,
            db::get_mysql_version,
            // Data Tools
            db::export_table_csv,
            db::export_table_json,
            db::export_table_sql,
            db::import_csv,
            db::preview_mock_data,
            db::start_mock_data_generation,
            db::get_mock_data_generation_status,
            db::list_mock_data_generation_history,
            db::cancel_mock_data_generation,
            db::backup_database,
            db::restore_database,
            db::compare_table_data,
            db::generate_data_sync_script,
            data_transfer::commands::preview_data_transfer_plan,
            data_transfer::commands::start_data_transfer,
            data_transfer::commands::get_data_transfer_status,
            data_transfer::commands::list_data_transfer_runs,
            data_transfer::commands::cancel_data_transfer,
            data_transfer::commands::validate_data_transfer_mapping,
            data_transfer::commands::generate_transfer_task_payload,
            // Query Execution
            db::execute_query,
            db::execute_query_profiled,
            // ClickHouse specific
            clickhouse::get_clickhouse_table_info,
            clickhouse::get_clickhouse_partitions,
            clickhouse::manage_partition,
            clickhouse::get_clickhouse_query_log,
            clickhouse::get_clickhouse_kafka_consumers,
            clickhouse::get_clickhouse_merges,
            clickhouse::get_clickhouse_mutations,
            clickhouse::get_clickhouse_query_profile,
            clickhouse::compare_clickhouse_query_profiles,
            clickhouse::get_clickhouse_query_plan,
            clickhouse::get_clickhouse_query_history,
            clickhouse::get_clickhouse_optimization_suggestions,
            clickhouse::get_clickhouse_table_storage_info,
            clickhouse::get_clickhouse_storage_suggestions,
            clickhouse::get_clickhouse_ttl_status,
            clickhouse::modify_clickhouse_ttl,
            clickhouse::get_clickhouse_ttl_preview,
            clickhouse::get_clickhouse_ttl_audit,
            clickhouse::get_clickhouse_system_metrics,
            // ClickHouse User Management
            clickhouse::get_clickhouse_users,
            clickhouse::create_clickhouse_user,
            clickhouse::update_clickhouse_user,
            clickhouse::delete_clickhouse_user,
            clickhouse::get_clickhouse_roles,
            clickhouse::grant_clickhouse_privilege,
            clickhouse::revoke_clickhouse_privilege,
            // Settings Profiles
            clickhouse::get_clickhouse_profiles,
            clickhouse::get_clickhouse_profile_details,
            clickhouse::create_clickhouse_profile,
            clickhouse::update_clickhouse_profile,
            clickhouse::delete_clickhouse_profile,
            // Database/Table Operations
            db::get_databases,
            db::get_schemas,
            db::get_tables,
            db::get_table_schema,
            db::get_table_ddl,
            db::get_dictionaries,
            // Indexes & Keys
            db::get_table_indexes,
            db::get_table_foreign_keys,
            db::get_indexes,
            db::get_foreign_keys,
            db::get_table_primary_keys,
            db::get_table_constraints,
            db::get_table_stats,
            // Views
            db::get_views,
            db::get_view_definition,
            db::alter_view,
            // Triggers
            db::get_triggers,
            db::get_table_triggers,
            // Procedures & Functions
            db::get_procedures,
            db::get_functions,
            // Events (MySQL)
            db::get_events,
            // User Management
            db::get_users,
            db::get_user_privileges,
            db::manage_privilege,
            db::manage_user_status,
            db::manage_role,
            db::get_role_edges,
            // Server Monitoring
            db::get_monitor_snapshot,
            db::get_monitor_history,
            db::get_monitor_alerts,
            db::save_monitor_alert,
            db::delete_monitor_alert,
            db::get_bloat_analysis,
            db::kill_process,
            db::analyze_query,
            db::get_lock_analysis,
            db::get_slow_queries,
            db::get_index_suggestions,
            db::get_index_usage,
            db::get_index_sizes,
            db::get_index_fragmentation,
            db::maintain_index,
            db::simulate_index_drop,
            db::get_capacity_metrics,
            db::get_execution_plan,
            db::compare_queries,
            db::get_anomaly_history,
            db::get_anomaly_cause,
            db::get_query_history,
            db::get_query_history_range,
            // AI Index Recommendations
            db::get_ai_index_recommendations,
            db::start_agent_job,
            db::stop_agent_job,
            db::get_agent_jobs,
            db::get_storage_stats,

            // PostgreSQL Specific
            db::get_sequences,
            db::get_custom_types,
            db::get_extensions,
            db::manage_extension,
            db::get_tablespaces,
            db::get_pg_activity,
            db::kill_pg_session,
            db::get_pg_locks,
            // Schema Tracker
            schema_tracker::commands::capture_schema_snapshot,
            schema_tracker::commands::compare_schema_snapshots,
            schema_tracker::commands::detect_breaking_changes,
            schema_tracker::commands::generate_migration,
            schema_tracker::commands::generate_migration_plan,
            schema_tracker::commands::add_snapshot_tag,
            schema_tracker::commands::get_schema_snapshots,
            schema_tracker::commands::save_ai_impact_report,
            schema_tracker::commands::get_ai_impact_report,
            schema_tracker::commands::generate_story_command,
            quality_analyzer::commands::run_quality_analysis,
            quality_analyzer::commands::get_quality_reports,
            quality_analyzer::commands::save_quality_ai_report,
            quality_analyzer::commands::get_quality_ai_report,
            quality_analyzer::commands::save_quality_rule,
            quality_analyzer::commands::get_quality_rules,
            quality_analyzer::commands::delete_quality_rule,
            quality_analyzer::commands::check_charset_mismatches,
            // Dependency Engine
            dependency_engine::commands::get_dependency_graph,
            dependency_engine::commands::get_clickhouse_data_lineage,
            // ER Diagram
            er_diagram::commands::build_er_graph,
            er_diagram::commands::save_er_layout,
            er_diagram::commands::get_er_layout,
            er_diagram::commands::list_er_layouts,
            er_diagram::commands::delete_er_layout,
            integration::commands::check_impact,
            // Query Story
            query_story::commands::create_query_story,
            query_story::commands::get_query_story,
            query_story::commands::get_all_query_stories,
            query_story::commands::add_query_version,
            query_story::commands::add_query_comment,
            query_story::commands::update_query_context,
            query_story::commands::toggle_query_favorite,
            query_story::commands::increment_query_execution,
            query_story::commands::compare_query_versions,
            query_story::commands::delete_query_story,
            query_story::commands::calculate_query_hash,
            // Task Manager
            task_manager::commands::create_task,
            task_manager::commands::get_task,
            task_manager::commands::list_tasks,
            task_manager::commands::update_task,
            task_manager::commands::delete_task,
            task_manager::commands::create_task_trigger,
            task_manager::commands::get_task_trigger,
            task_manager::commands::list_task_triggers,
            task_manager::commands::update_task_trigger,
            task_manager::commands::delete_task_trigger,
            task_manager::commands::get_task_runs,
            task_manager::commands::get_task_run_logs,
            task_manager::commands::list_task_audit_logs,
            task_manager::commands::get_task_log_retention_policy,
            task_manager::commands::set_task_log_retention_policy,
            task_manager::commands::purge_task_history,
            task_manager::commands::upsert_composite_task_graph,
            task_manager::commands::get_composite_task_graph,
            task_manager::commands::get_composite_step_runs,
            task_manager::commands::run_task_now,
            task_manager::commands::cancel_task_run,
            task_manager::commands::retry_task_run,
            task_manager::commands::get_scheduler_state,
            task_manager::commands::set_scheduler_state,
            task_manager::commands::pause_scheduler,
            task_manager::commands::resume_scheduler,
            task_manager::commands::disable_scheduler,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
