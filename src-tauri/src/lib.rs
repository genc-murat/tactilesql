// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
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

// Database modules
mod db_types;
mod mysql;
mod postgres;
mod db;
mod common;
pub mod awareness;
pub mod schema_tracker;
pub mod chronicle;
pub mod quality_analyzer;
pub mod dependency_engine;
pub mod integration;
pub mod scheduler;
pub mod query_story;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db::AppState::default())
        .setup(|app| {
            // Get all webview windows and set size constraints
            use tauri::LogicalSize;
            println!("Setting up windows...");
            for (label, window) in app.webview_windows() {
                println!("Found window with label: {}", label);
                match window.set_min_size(Some(LogicalSize::new(1280.0, 800.0))) {
                    Ok(_) => println!("Successfully set min size for window: {}", label),
                    Err(e) => println!("Error setting min size: {}", e),
                }
            }

            // Initialize Encryption Key
            let app_handle = app.handle();
            let state = app.state::<db::AppState>();
            match db::initialize_key(app_handle) {
                Ok(key) => {
                    let mut guard = futures::executor::block_on(state.encryption_key.lock());
                    *guard = Some(key);
                    println!("Encryption key initialized successfully (from Keychain or Migration).");
                },
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

                        // Awareness Store
                        match crate::awareness::store::AwarenessStore::new(pool.clone()).await {
                            Ok(store) => {
                                 let mut guard = state.awareness_store.lock().await;
                                 *guard = Some(store);
                                 println!("Awareness Store initialized.");
                            },
                            Err(e) => eprintln!("Failed to init Awareness Store: {}", e),
                        }
                        
                        // Schema Tracker Store
                        match crate::schema_tracker::storage::SchemaTrackerStore::new(pool.clone()).await {
                            Ok(store) => {
                                 let mut guard = state.schema_tracker_store.lock().await;
                                 *guard = Some(store);
                                 println!("Schema Tracker Store initialized.");
                            },
                            Err(e) => eprintln!("Failed to init Schema Tracker Store: {}", e),
                        }

                        // Quality Analyzer Store
                        match crate::quality_analyzer::storage::QualityAnalyzerStore::new(pool.clone()).await {
                            Ok(store) => {
                                 let mut guard = state.quality_analyzer_store.lock().await;
                                 *guard = Some(store);
                                 println!("Quality Analyzer Store initialized.");
                            },
                            Err(e) => eprintln!("Failed to init Quality Analyzer Store: {}", e),
                        }

                        // Dependency Engine Store
                        match crate::dependency_engine::storage::DependencyEngineStore::new(pool.clone()).await {
                            Ok(store) => {
                                 let mut guard = state.dependency_engine_store.lock().await;
                                 *guard = Some(store);
                                 println!("Dependency Engine Store initialized.");
                            },
                            Err(e) => eprintln!("Failed to init Dependency Engine Store: {}", e),
                        }

                        // Query Story Store
                        match crate::query_story::storage::QueryStoryStore::new(pool.clone()).await {
                            Ok(store) => {
                                 let mut guard = state.query_story_store.lock().await;
                                 *guard = Some(store);
                                 println!("Query Story Store initialized.");
                            },
                            Err(e) => eprintln!("Failed to init Query Story Store: {}", e),
                        }
                    },
                    Err(e) => eprintln!("Failed to initialize Local Storage: {}", e),
                }
            });

            // Start Scheduler
            let scheduler_handle = app.handle().clone();
            crate::scheduler::start_scheduler(scheduler_handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            // DevTools
            open_devtools,
            close_devtools,
            is_devtools_open,
            // Connection Management
            db::test_connection, 
            db::establish_connection,
            db::disconnect,
            db::get_active_db_type,
            db::save_connection,
            db::load_connections,
            db::delete_connection,
            // Query Execution
            db::execute_query,
            db::execute_query_profiled,
            // Database/Table Operations
            db::get_databases,
            db::get_schemas,
            db::get_tables,
            db::get_table_schema,
            db::get_table_ddl,
            // Indexes & Keys
            db::get_table_indexes,
            db::get_table_foreign_keys,
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
            // Server Monitoring
            db::get_server_status,
            db::get_process_list,
            db::kill_process,
            db::get_innodb_status,
            db::get_replication_status,
            db::get_locks,
            db::get_slow_queries,
            // Query Analysis
            db::analyze_query,
            db::get_index_suggestions,
            db::get_index_usage,
            db::get_index_sizes,
            db::get_capacity_metrics,
            db::get_execution_plan,
            db::compare_queries,
            db::get_anomaly_history,
            db::get_anomaly_cause,
            db::get_query_history,
            // AI Index Recommendations
            db::get_ai_index_recommendations,
            // PostgreSQL Specific
            db::get_sequences,
            db::get_custom_types,
            db::get_extensions,
            db::get_tablespaces,
            // Schema Tracker
            schema_tracker::commands::capture_schema_snapshot,
            schema_tracker::commands::compare_schema_snapshots,
            schema_tracker::commands::detect_breaking_changes,
            schema_tracker::commands::generate_migration,
            schema_tracker::commands::add_snapshot_tag,
            schema_tracker::commands::get_schema_snapshots,
            schema_tracker::commands::save_ai_impact_report,
            schema_tracker::commands::get_ai_impact_report,
            schema_tracker::commands::generate_story_command,
            quality_analyzer::commands::run_quality_analysis,
            quality_analyzer::commands::get_quality_reports,
            quality_analyzer::commands::save_quality_ai_report,
            quality_analyzer::commands::get_quality_ai_report,
            // Dependency Engine
            dependency_engine::commands::get_dependency_graph,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
