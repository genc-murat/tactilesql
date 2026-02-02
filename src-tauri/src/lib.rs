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
pub mod awareness;

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

            // Initialize Awareness Store
            let app_handle_clone = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match crate::awareness::store::AwarenessStore::new(&app_handle_clone).await {
                    Ok(store) => {
                         let state = app_handle_clone.state::<db::AppState>();
                         let mut guard = state.awareness_store.lock().await;
                         *guard = Some(store);
                         println!("Awareness Store initialized successfully.");
                    },
                    Err(e) => eprintln!("Failed to initialize Awareness Store: {}", e),
                }
            });

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
            db::analyze_query,
            db::get_index_suggestions,
            db::get_execution_plan,
            db::compare_queries,
            db::get_anomaly_history,
            db::get_query_history,
            // PostgreSQL Specific
            db::get_sequences,
            db::get_custom_types,
            db::get_extensions,
            db::get_tablespaces
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
