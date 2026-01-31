// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db::AppState::default())
        .invoke_handler(tauri::generate_handler![
            greet, 
            db::test_connection, 
            db::get_connections, 
            db::save_connection, 
            db::delete_connection,
            db::establish_connection,
            db::execute_query,
            db::get_databases,
            db::get_tables,
            db::get_table_schema,
            db::get_mysql_users,
            db::get_user_privileges,
            db::get_table_indexes,
            db::get_table_foreign_keys,
            db::get_table_primary_keys,
            db::get_table_constraints,
            db::get_table_stats,
            db::get_table_ddl,
            db::get_views,
            db::get_triggers,
            db::get_table_triggers,
            db::get_procedures,
            db::get_functions,
            db::get_events,
            db::get_view_definition,
            db::alter_view
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
