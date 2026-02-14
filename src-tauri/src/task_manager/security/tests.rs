use super::*;
use serde_json::json;

#[test]
fn test_redact_sensitive_text() {
    assert_eq!(redact_sensitive_text("password: mypass"), "password:[REDACTED]");
    assert_eq!(redact_sensitive_text("PWD=secret"), "PWD=[REDACTED]");
    assert_eq!(redact_sensitive_text("api-key: 12345"), "api-key:[REDACTED]");
    assert_eq!(redact_sensitive_text("mysql://user:pass@localhost"), "mysql://user:[REDACTED]@localhost");
}

#[test]
fn test_redact_sensitive_json() {
    let input = json!({
        "name": "my task",
        "config": {
            "password": "123",
            "db_url": "postgres://u:p@host",
            "other": "val"
        },
        "secrets": ["secret1", "secret2"]
    });
    
    let redacted = redact_sensitive_json(&input);
    
    assert_eq!(redacted["name"], "my task");
    assert_eq!(redacted["config"]["password"], "[REDACTED]");
    assert_eq!(redacted["config"]["db_url"], "postgres://u:[REDACTED]@host");
    assert_eq!(redacted["config"]["other"], "val");
    // "secrets" contains "secret" in key name, so whole array might be redacted if it was an object key,
    // but here it's an object key "secrets" which matches "secret" token.
}

#[test]
fn test_is_sensitive_key() {
    assert!(is_sensitive_key("password"));
    assert!(is_sensitive_key("api-key"));
    assert!(is_sensitive_key("SecretToken"));
    assert!(is_sensitive_key("connection_string"));
    assert!(!is_sensitive_key("username"));
}
