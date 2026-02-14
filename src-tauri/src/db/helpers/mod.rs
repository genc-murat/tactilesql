// =====================================================
// HELPERS MODULE  
// Generic utility functions (type conversion, string utilities)
// =====================================================

/// Convert usize to i64, clamping to i64::MAX on overflow
pub fn usize_to_i64(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

/// Convert u64 to i64, clamping to i64::MAX on overflow
pub fn u64_to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

/// Convert i64 to usize, returning 0 for negative values
pub fn i64_to_usize(value: i64) -> usize {
    if value <= 0 {
        0
    } else {
        usize::try_from(value).unwrap_or(usize::MAX)
    }
}

/// Convert i64 to u64, returning None for negative values
pub fn i64_to_u64(value: i64) -> Option<u64> {
    if value < 0 {
        None
    } else {
        Some(u64::try_from(value).unwrap_or(u64::MAX))
    }
}

/// Parse JSON string array, returning empty vec on failure
pub fn parse_warnings_json(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

/// Collapse multiple whitespace characters into single spaces
#[allow(dead_code)]
pub fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Truncate string to max_chars, adding "..." if truncated
#[allow(dead_code)]
pub fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (idx, ch) in value.chars().enumerate() {
        if idx >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

/// Clamp i32 value between min and max
pub fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

/// Round f64 to 2 decimal places
pub fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests;
