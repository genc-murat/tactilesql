use crate::db::AppState;
use crate::query_story::models::*;
use tauri::State;

#[tauri::command]
pub async fn create_query_story(
    app_state: State<'_, AppState>,
    request: CreateQueryStoryRequest,
) -> Result<QueryStory, String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.create_story(request).await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_query_story(
    app_state: State<'_, AppState>,
    query_hash: String,
) -> Result<Option<QueryStory>, String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_story(&query_hash).await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn get_all_query_stories(
    app_state: State<'_, AppState>,
    limit: i64,
) -> Result<Vec<StorySummary>, String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.get_all_stories(limit).await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn add_query_version(
    app_state: State<'_, AppState>,
    request: AddVersionRequest,
) -> Result<QueryVersion, String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.add_version(request).await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn add_query_comment(
    app_state: State<'_, AppState>,
    request: AddCommentRequest,
) -> Result<Comment, String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.add_comment(request).await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn update_query_context(
    app_state: State<'_, AppState>,
    request: UpdateContextRequest,
) -> Result<(), String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.update_context(request).await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn toggle_query_favorite(
    app_state: State<'_, AppState>,
    query_hash: String,
) -> Result<bool, String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.toggle_favorite(&query_hash).await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn increment_query_execution(
    app_state: State<'_, AppState>,
    query_hash: String,
) -> Result<(), String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.increment_execution(&query_hash).await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn compare_query_versions(
    app_state: State<'_, AppState>,
    query_hash: String,
    version1: u32,
    version2: u32,
) -> Result<DiffResult, String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store
            .compare_versions(&query_hash, version1, version2)
            .await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn delete_query_story(
    app_state: State<'_, AppState>,
    query_hash: String,
) -> Result<(), String> {
    let guard = app_state.query_story_store.lock().await;
    if let Some(store) = guard.as_ref() {
        store.delete_story(&query_hash).await
    } else {
        Err("Query story store not initialized".to_string())
    }
}

#[tauri::command]
pub async fn calculate_query_hash(query: String) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(query.trim().to_lowercase().as_bytes());
    Ok(format!("{:x}", hasher.finalize()))
}
