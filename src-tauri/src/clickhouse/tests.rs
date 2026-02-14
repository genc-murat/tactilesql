use super::*;
use crate::db_types::{DatabaseType, ConnectionConfig};

#[test]
fn test_create_client_basic() {
    let config = ConnectionConfig {
        id: None,
        name: None,
        db_type: DatabaseType::ClickHouse,
        host: "localhost".to_string(),
        port: 8123,
        username: "default".to_string(),
        password: Some("password".to_string()),
        database: Some("test_db".to_string()),
        password_encrypted: false,
        color: None,
        ssl_mode: None,
        schema: None,
        use_ssh_tunnel: false,
        ssh_host: None,
        ssh_port: None,
        ssh_username: None,
        ssh_password: None,
        ssh_key_path: None,
    };

    let result = create_client(&config);
    assert!(result.is_ok());
}

#[test]
fn test_create_client_with_http_prefix() {
    let mut config = ConnectionConfig {
        id: None,
        name: None,
        db_type: DatabaseType::ClickHouse,
        host: "http://clickhouse.local".to_string(),
        port: 8123,
        username: "default".to_string(),
        password: None,
        database: None,
        password_encrypted: false,
        color: None,
        ssl_mode: None,
        schema: None,
        use_ssh_tunnel: false,
        ssh_host: None,
        ssh_port: None,
        ssh_username: None,
        ssh_password: None,
        ssh_key_path: None,
    };

    let result = create_client(&config);
    assert!(result.is_ok());
    
    config.host = "clickhouse.local".to_string();
    let result = create_client(&config);
    assert!(result.is_ok());
}
