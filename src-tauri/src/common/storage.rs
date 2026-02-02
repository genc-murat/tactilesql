use std::fs;
use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite};
use tauri::AppHandle;
use tauri::Manager;

pub async fn init_local_db(app_handle: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    let storage_dir = app_data_dir.join("storage");
    if !storage_dir.exists() {
        fs::create_dir_all(&storage_dir).map_err(|e| e.to_string())?;
    }

    let db_path = storage_dir.join("local.db");
    let db_url = format!("sqlite:{}", db_path.to_string_lossy());

    // Create file if not exists
    if !db_path.exists() {
        fs::File::create(&db_path).map_err(|e| e.to_string())?;
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(&db_url)
        .await
        .map_err(|e| format!("Failed to connect to local DB: {}", e))?;

    // Enable WAL for concurrency
    sqlx::query("PRAGMA journal_mode=WAL;")
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    Ok(pool)
}
