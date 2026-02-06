use crate::db;
use crate::db_types::{AppState, ConnectionConfig, DatabaseType};
use tauri::AppHandle;

#[derive(Debug, Clone)]
pub struct ResolvedTransferConnection {
    pub connection_id: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub config: ConnectionConfig,
}

fn normalize_connection_id(value: &str) -> String {
    value.trim().to_string()
}

pub fn resolve_connection_by_id(
    app_handle: &AppHandle,
    app_state: &AppState,
    connection_id: &str,
) -> Result<ResolvedTransferConnection, String> {
    let normalized_id = normalize_connection_id(connection_id);
    if normalized_id.is_empty() {
        return Err("connectionId is required".to_string());
    }

    let connections = db::load_connections_with_decrypted_passwords(app_handle, app_state)?;
    let config = connections
        .into_iter()
        .find(|item| {
            item.id
                .as_deref()
                .map(str::trim)
                .map(|id| id == normalized_id)
                .unwrap_or(false)
        })
        .ok_or_else(|| format!("Connection '{}' not found", normalized_id))?;

    if matches!(config.db_type, DatabaseType::Disconnected) {
        return Err(format!(
            "Connection '{}' is disconnected and cannot be used for transfer",
            normalized_id
        ));
    }

    Ok(ResolvedTransferConnection {
        connection_id: normalized_id,
        db_type: config.db_type.clone(),
        host: config.host.clone(),
        port: config.port,
        database: config.database.clone(),
        schema: config.schema.clone(),
        config,
    })
}
