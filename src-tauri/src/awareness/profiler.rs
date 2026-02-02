use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use regex::Regex;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub execution_time_ms: f64,
    pub rows_affected: u64,
    // Future metrics: CPU time, Memory usage, etc.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryExecution {
    pub query_hash: String,
    pub exact_query: String,
    pub timestamp: DateTime<Utc>,
    pub resources: ResourceUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineProfile {
    pub query_hash: String,
    pub query_pattern: String,
    pub avg_duration_ms: f64,
    pub std_dev_duration_ms: f64,
    pub total_executions: u64,
    pub last_updated: DateTime<Utc>,
}

pub fn normalize_query(query: &str) -> String {
    // 1. Trim whitespace
    let mut normalized = query.trim().to_string();

    // 2. Collapse multiple whitespace into single space
    let re_whitespace = Regex::new(r"\s+").unwrap();
    normalized = re_whitespace.replace_all(&normalized, " ").to_string();

    // 3. Mask literals (numbers, strings) to simplify pattern
    // Mask strings '...'
    let re_string = Regex::new(r"'[^']*'").unwrap();
    normalized = re_string.replace_all(&normalized, "?").to_string();

    // Mask numbers
    let re_number = Regex::new(r"\b\d+\b").unwrap();
    normalized = re_number.replace_all(&normalized, "?").to_string();

    // 4. Lowercase (optional, maybe unsafe depending on DB case sensitivity for tables, usually good for keywords)
    // For now, let's keep case as is but maybe lowercase keywords? 
    // Safest is to just keep it, or only lowercase if we are sure.
    // Let's lowercase the whole thing for normalization purposes, assuming table names are case insensitive or user is consistent.
    // PostgreSQL is case sensitive for quoted identifiers. MySQL depends on OS.
    // Let's NOT lowercase for now to be safe, or maybe just standard keywords.
    
    normalized
}

pub fn calculate_query_hash(normalized_query: &str) -> String {
    let mut hasher = DefaultHasher::new();
    normalized_query.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_query() {
        let q1 = "SELECT * FROM users WHERE id = 123";
        let q2 = "SELECT * FROM   users   WHERE id = 456";
        let q3 = "SELECT * FROM users WHERE name = 'John'";

        let n1 = normalize_query(q1);
        let n2 = normalize_query(q2);
        let n3 = normalize_query(q3);

        assert_eq!(n1, "SELECT * FROM users WHERE id = ?");
        assert_eq!(n2, "SELECT * FROM users WHERE id = ?");
        assert_eq!(n3, "SELECT * FROM users WHERE name = ?");
    }

    #[test]
    fn test_query_hash() {
        let q1 = "SELECT * FROM users WHERE id = ?";
        let h1 = calculate_query_hash(q1);
        let h2 = calculate_query_hash(q1);
        assert_eq!(h1, h2);
    }
}
