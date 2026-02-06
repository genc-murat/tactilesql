use regex::{Captures, Regex};
use serde_json::{Map, Value};
use std::sync::LazyLock;

const REDACTED: &str = "[REDACTED]";

static INLINE_SECRET_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\b\s*([:=])\s*([^\s,;]+)",
    )
    .unwrap()
});

static URI_CREDENTIAL_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)([a-z][a-z0-9+.-]*://[^:@/\s]+:)([^@/\s]+)(@)").unwrap()
});

const SENSITIVE_KEY_TOKENS: &[&str] = &[
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_key",
    "private_key",
    "connectionstring",
    "credential",
];

pub fn redact_sensitive_text(input: &str) -> String {
    let redacted_inline = INLINE_SECRET_REGEX.replace_all(input, |caps: &Captures| {
        format!("{}{}{}", &caps[1], &caps[2], REDACTED)
    });
    URI_CREDENTIAL_REGEX
        .replace_all(&redacted_inline, |caps: &Captures| {
            format!("{}{}{}", &caps[1], REDACTED, &caps[3])
        })
        .to_string()
}

pub fn redact_sensitive_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(redact_object(map)),
        Value::Array(values) => Value::Array(values.iter().map(redact_sensitive_json).collect()),
        Value::String(text) => Value::String(redact_sensitive_text(text)),
        other => other.clone(),
    }
}

fn redact_object(map: &Map<String, Value>) -> Map<String, Value> {
    let mut output = Map::new();
    for (key, value) in map {
        if is_sensitive_key(key) {
            output.insert(key.clone(), Value::String(REDACTED.to_string()));
        } else {
            output.insert(key.clone(), redact_sensitive_json(value));
        }
    }
    output
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' ', '.'], "_");
    SENSITIVE_KEY_TOKENS
        .iter()
        .any(|token| normalized.contains(token))
}
