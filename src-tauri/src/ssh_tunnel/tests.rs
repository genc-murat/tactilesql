use super::*;
use crate::db_types::{DatabaseType, ConnectionConfig};

#[test]
fn test_expand_path() {
    // Test absolute path
    assert_eq!(expand_path("/tmp/test"), PathBuf::from("/tmp/test"));
    
    // Test home directory expansion (if possible in test env)
    if let Some(home) = dirs::home_dir() {
        assert_eq!(expand_path("~/test.key"), home.join("test.key"));
        assert_eq!(expand_path("~"), home);
    }
}

#[test]
fn test_validate_ssh_config() {
    let valid = SSHTunnelConfig {
        host: "localhost".to_string(),
        port: 22,
        username: "user".to_string(),
        password: None,
        key_path: None,
    };
    assert!(validate_ssh_config(&valid).is_ok());

    let invalid_host = SSHTunnelConfig {
        host: "  ".to_string(),
        port: 22,
        username: "user".to_string(),
        password: None,
        key_path: None,
    };
    assert!(validate_ssh_config(&invalid_host).is_err());

    let invalid_user = SSHTunnelConfig {
        host: "localhost".to_string(),
        port: 22,
        username: "".to_string(),
        password: None,
        key_path: None,
    };
    assert!(validate_ssh_config(&invalid_user).is_err());
}

#[test]
fn test_extract_ssh_config() {
    let mut conn = ConnectionConfig {
        id: None,
        name: None,
        db_type: DatabaseType::MySQL,
        host: "db.local".to_string(),
        port: 3306,
        username: "dbuser".to_string(),
        password: None,
        database: None,
        password_encrypted: false,
        color: None,
        ssl_mode: None,
        schema: None,
        use_ssh_tunnel: true,
        ssh_host: Some("ssh.local".to_string()),
        ssh_port: Some(2222),
        ssh_username: Some("sshuser".to_string()),
        ssh_password: Some("pass".to_string()),
        ssh_key_path: Some("/path/to/key".to_string()),
    };

    let ssh_cfg = extract_ssh_config(&conn).unwrap();
    assert_eq!(ssh_cfg.host, "ssh.local");
    assert_eq!(ssh_cfg.port, 2222);
    assert_eq!(ssh_cfg.username, "sshuser");
    assert_eq!(ssh_cfg.password, Some("pass".to_string()));
    assert_eq!(ssh_cfg.key_path, Some("/path/to/key".to_string()));

    // Test defaults
    conn.ssh_port = None;
    let ssh_cfg = extract_ssh_config(&conn).unwrap();
    assert_eq!(ssh_cfg.port, 22);

    // Test missing required fields
    conn.ssh_host = None;
    assert!(extract_ssh_config(&conn).is_err());
}

#[test]
fn test_parse_socket_addr() {
    // Use a definitely valid address
    let addr = parse_socket_addr("127.0.0.1", 8080);
    assert!(addr.is_ok());
    assert_eq!(addr.unwrap().port(), 8080);

    // Test invalid host
    let addr = parse_socket_addr("invalid-host-name-that-should-not-resolve", 80);
    assert!(addr.is_err());
}
