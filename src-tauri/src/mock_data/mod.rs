use crate::db_types::ColumnSchema;
use chrono::{Duration, NaiveDate};
use rand::{rngs::StdRng, Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use std::collections::{HashMap, HashSet};

const UNIQUE_RETRY_LIMIT: usize = 25;
const DEFAULT_TEXT_LEN: usize = 64;

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MockColumnRule {
    pub generator: Option<String>,
    pub fixed_value: Option<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub max_length: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct MockGenerationConfig {
    pub row_count: usize,
    pub seed: Option<u64>,
    pub include_nullable_columns: bool,
    pub column_rules: HashMap<String, MockColumnRule>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockGenerationOutput {
    pub seed: u64,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub skipped_columns: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug)]
enum GeneratorKind {
    Auto,
    Text,
    Integer,
    Decimal,
    Boolean,
    Date,
    DateTime,
}

impl GeneratorKind {
    fn from_str(raw: &str) -> Option<Self> {
        let normalized = raw.trim().to_lowercase();
        match normalized.as_str() {
            "" | "auto" => Some(Self::Auto),
            "text" | "string" | "varchar" => Some(Self::Text),
            "int" | "integer" | "number" => Some(Self::Integer),
            "decimal" | "numeric" | "float" | "double" => Some(Self::Decimal),
            "bool" | "boolean" => Some(Self::Boolean),
            "date" => Some(Self::Date),
            "datetime" | "timestamp" => Some(Self::DateTime),
            _ => None,
        }
    }
}

pub fn generate_rows(
    schema: &[ColumnSchema],
    config: &MockGenerationConfig,
) -> Result<MockGenerationOutput, String> {
    if config.row_count == 0 {
        return Err("Row count must be greater than 0".to_string());
    }

    let seed = config.seed.unwrap_or_else(rand::random::<u64>);
    let mut rng = StdRng::seed_from_u64(seed);

    let normalized_rules = config
        .column_rules
        .iter()
        .map(|(k, v)| (k.to_lowercase(), v.clone()))
        .collect::<HashMap<String, MockColumnRule>>();

    let mut active_columns = Vec::new();
    let mut skipped_columns = Vec::new();

    for column in schema {
        if should_skip_column(column, config.include_nullable_columns) {
            skipped_columns.push(column.name.clone());
            continue;
        }
        active_columns.push(column.clone());
    }

    if active_columns.is_empty() {
        return Err(
            "No eligible columns found for mock data generation (all columns were skipped)"
                .to_string(),
        );
    }

    validate_unique_rules(&active_columns, config, &normalized_rules)?;

    let mut unique_trackers: HashMap<String, HashSet<String>> = HashMap::new();
    let mut rows = Vec::with_capacity(config.row_count);

    for row_index in 0..config.row_count {
        let mut row_values = Vec::with_capacity(active_columns.len());

        for column in &active_columns {
            let rule = normalized_rules.get(&column.name.to_lowercase());
            let is_unique = is_unique_column(column);
            let mut attempts = 0usize;

            loop {
                let generated = generate_value(
                    column,
                    rule,
                    row_index as u64,
                    config.include_nullable_columns,
                    is_unique,
                    attempts,
                    &mut rng,
                )?;

                if is_unique && !generated.is_null() {
                    let marker = generated.to_string();
                    let tracker = unique_trackers.entry(column.name.clone()).or_default();
                    if tracker.contains(&marker) {
                        attempts += 1;
                        if attempts >= UNIQUE_RETRY_LIMIT {
                            return Err(format!(
                                "Failed to generate a unique value for column '{}' after {} attempts. Try widening column rule range or reducing row count.",
                                column.name, UNIQUE_RETRY_LIMIT
                            ));
                        }
                        continue;
                    }
                    tracker.insert(marker);
                }

                row_values.push(generated);
                break;
            }
        }

        rows.push(row_values);
    }

    let warnings = if skipped_columns.is_empty() {
        Vec::new()
    } else {
        vec![format!(
            "Skipped columns: {}",
            skipped_columns.join(", ")
        )]
    };

    Ok(MockGenerationOutput {
        seed,
        columns: active_columns.into_iter().map(|c| c.name).collect(),
        rows,
        skipped_columns,
        warnings,
    })
}

fn validate_unique_rules(
    active_columns: &[ColumnSchema],
    config: &MockGenerationConfig,
    normalized_rules: &HashMap<String, MockColumnRule>,
) -> Result<(), String> {
    for column in active_columns {
        if !is_unique_column(column) {
            continue;
        }
        let rule = normalized_rules.get(&column.name.to_lowercase());
        if config.row_count > 1 && rule.and_then(|r| r.fixed_value.as_deref()).is_some() {
            return Err(format!(
                "Column '{}' is unique and uses a fixed value. Remove fixed value or set row count to 1.",
                column.name
            ));
        }

        let kind = resolve_generator_kind(column, rule)?;
        if matches!(kind, GeneratorKind::Boolean) && config.row_count > 2 {
            return Err(format!(
                "Column '{}' is unique boolean and supports at most 2 unique values.",
                column.name
            ));
        }

        if matches!(kind, GeneratorKind::Integer) {
            let (min, max) = resolve_integer_bounds(column, rule);
            let capacity = (i128::from(max) - i128::from(min) + 1).max(0) as usize;
            if config.row_count > capacity {
                return Err(format!(
                    "Column '{}' unique integer range can generate at most {} values (requested {}).",
                    column.name, capacity, config.row_count
                ));
            }
        }
    }
    Ok(())
}

fn should_skip_column(column: &ColumnSchema, include_nullable_columns: bool) -> bool {
    if is_auto_generated_column(column) {
        return true;
    }
    !include_nullable_columns && column.is_nullable && !is_unique_column(column)
}

fn is_auto_generated_column(column: &ColumnSchema) -> bool {
    let extra = column.extra.to_lowercase();
    extra.contains("auto_increment") || extra.contains("generated") || extra.contains("identity")
}

fn is_unique_column(column: &ColumnSchema) -> bool {
    let key = column.column_key.to_uppercase();
    key.contains("PRI") || key.contains("UNI")
}

fn generate_value(
    column: &ColumnSchema,
    rule: Option<&MockColumnRule>,
    row_index: u64,
    include_nullable_columns: bool,
    is_unique: bool,
    unique_attempt: usize,
    rng: &mut StdRng,
) -> Result<Value, String> {
    let generator_kind = resolve_generator_kind(column, rule)?;

    if let Some(fixed) = rule.and_then(|r| r.fixed_value.as_deref()) {
        return parse_fixed_value(fixed, generator_kind);
    }

    if column.is_nullable && include_nullable_columns && !is_unique && rng.gen_bool(0.15) {
        return Ok(Value::Null);
    }

    match generator_kind {
        GeneratorKind::Text | GeneratorKind::Auto => Ok(Value::String(generate_text_value(
            column,
            rule,
            row_index,
            is_unique,
            unique_attempt,
            rng,
        ))),
        GeneratorKind::Integer => Ok(Value::Number(
            generate_integer_value(column, rule, row_index, is_unique, unique_attempt, rng).into(),
        )),
        GeneratorKind::Decimal => Ok(Value::Number(generate_decimal_value(
            rule,
            row_index,
            is_unique,
            unique_attempt,
            rng,
        )?)),
        GeneratorKind::Boolean => {
            if is_unique {
                Ok(Value::Bool((row_index + unique_attempt as u64) % 2 == 0))
            } else {
                Ok(Value::Bool(rng.gen_bool(0.5)))
            }
        }
        GeneratorKind::Date => Ok(Value::String(generate_date_value(
            row_index,
            is_unique,
            unique_attempt,
            rng,
        ))),
        GeneratorKind::DateTime => Ok(Value::String(generate_datetime_value(
            row_index,
            is_unique,
            unique_attempt,
            rng,
        ))),
    }
}

fn resolve_generator_kind(
    column: &ColumnSchema,
    rule: Option<&MockColumnRule>,
) -> Result<GeneratorKind, String> {
    if let Some(rule_generator) = rule.and_then(|r| r.generator.as_deref()) {
        match GeneratorKind::from_str(rule_generator) {
            Some(GeneratorKind::Auto) => {}
            Some(kind) => return Ok(kind),
            None => {
                return Err(format!(
                    "Unsupported generator '{}' for column '{}'",
                    rule_generator, column.name
                ))
            }
        }
    }
    Ok(infer_generator_kind(column))
}

fn infer_generator_kind(column: &ColumnSchema) -> GeneratorKind {
    let data_type = column.data_type.to_lowercase();
    let column_type = column.column_type.to_lowercase();

    if data_type == "uuid" {
        return GeneratorKind::Text;
    }

    if data_type == "bool" || data_type == "boolean" || column_type.contains("tinyint(1)") {
        return GeneratorKind::Boolean;
    }

    if data_type.contains("int")
        || data_type == "serial"
        || data_type == "bigserial"
        || data_type == "smallserial"
    {
        return GeneratorKind::Integer;
    }

    if data_type.contains("decimal")
        || data_type.contains("numeric")
        || data_type.contains("float")
        || data_type.contains("double")
        || data_type.contains("real")
    {
        return GeneratorKind::Decimal;
    }

    if data_type == "date" {
        return GeneratorKind::Date;
    }

    if data_type.contains("timestamp") || data_type.contains("datetime") || data_type == "time" {
        return GeneratorKind::DateTime;
    }

    GeneratorKind::Text
}

fn parse_fixed_value(raw: &str, kind: GeneratorKind) -> Result<Value, String> {
    match kind {
        GeneratorKind::Boolean => {
            let normalized = raw.trim().to_lowercase();
            if normalized == "1" || normalized == "true" {
                Ok(Value::Bool(true))
            } else if normalized == "0" || normalized == "false" {
                Ok(Value::Bool(false))
            } else {
                Err(format!("Invalid boolean fixed value '{}'", raw))
            }
        }
        GeneratorKind::Integer => {
            let parsed = raw
                .trim()
                .parse::<i64>()
                .map_err(|_| format!("Invalid integer fixed value '{}'", raw))?;
            Ok(Value::Number(parsed.into()))
        }
        GeneratorKind::Decimal => {
            let parsed = raw
                .trim()
                .parse::<f64>()
                .map_err(|_| format!("Invalid decimal fixed value '{}'", raw))?;
            let number = Number::from_f64(parsed)
                .ok_or_else(|| format!("Invalid decimal fixed value '{}'", raw))?;
            Ok(Value::Number(number))
        }
        GeneratorKind::Date
        | GeneratorKind::DateTime
        | GeneratorKind::Text
        | GeneratorKind::Auto => Ok(Value::String(raw.to_string())),
    }
}

fn generate_text_value(
    column: &ColumnSchema,
    rule: Option<&MockColumnRule>,
    row_index: u64,
    is_unique: bool,
    unique_attempt: usize,
    rng: &mut StdRng,
) -> String {
    let name = column.name.to_lowercase();
    let max_len = resolved_text_length(column, rule);

    if is_unique {
        return generate_unique_text_value(&name, max_len, row_index, unique_attempt);
    }

    let suffix = rng.gen_range(1000..9999);
    let value = if name.contains("email") {
        format!("user{}_{}@example.com", row_index + 1, suffix)
    } else if name.contains("phone") || name.contains("tel") {
        format!("+1-555-{:04}", suffix)
    } else if name.contains("first") && name.contains("name") {
        format!("First{}", row_index + 1)
    } else if name.contains("last") && name.contains("name") {
        format!("Last{}", row_index + 1)
    } else if name.contains("name") {
        format!("Name{}_{}", row_index + 1, suffix)
    } else if name.contains("city") {
        format!("City{}", (row_index % 250) + 1)
    } else if name.contains("country") {
        "USA".to_string()
    } else {
        format!("{}_{}_{}", sanitize_identifier(&name), row_index + 1, suffix)
    };

    truncate_to(value, max_len)
}

fn generate_integer_value(
    column: &ColumnSchema,
    rule: Option<&MockColumnRule>,
    row_index: u64,
    is_unique: bool,
    unique_attempt: usize,
    rng: &mut StdRng,
) -> i64 {
    let (min, max) = resolve_integer_bounds(column, rule);
    if is_unique {
        let span = (i128::from(max) - i128::from(min) + 1).max(1) as u128;
        let offset = (u128::from(row_index) + unique_attempt as u128) % span;
        return min.saturating_add(offset as i64);
    }
    rng.gen_range(min..=max)
}

fn generate_decimal_value(
    rule: Option<&MockColumnRule>,
    row_index: u64,
    is_unique: bool,
    unique_attempt: usize,
    rng: &mut StdRng,
) -> Result<Number, String> {
    let mut min = rule.and_then(|r| r.min).unwrap_or(0.0);
    let mut max = rule.and_then(|r| r.max).unwrap_or(10_000.0);
    if max < min {
        std::mem::swap(&mut min, &mut max);
    }
    let sampled = if is_unique {
        let step = ((row_index + unique_attempt as u64) as f64) * 0.01;
        min + step
    } else {
        rng.gen_range(min..=max)
    };
    let bounded = sampled.min(max);
    let bounded = bounded.max(min);
    let rounded = (bounded * 100.0).round() / 100.0;
    Number::from_f64(rounded)
        .ok_or_else(|| "Failed to build numeric mock value".to_string())
}

fn generate_date_value(
    row_index: u64,
    is_unique: bool,
    unique_attempt: usize,
    rng: &mut StdRng,
) -> String {
    let base = NaiveDate::from_ymd_opt(2020, 1, 1).expect("valid date");
    let offset_days = if is_unique {
        (row_index + unique_attempt as u64) as i64
    } else {
        rng.gen_range(0..=3650)
    };
    let value = base + Duration::days(offset_days);
    value.format("%Y-%m-%d").to_string()
}

fn generate_datetime_value(
    row_index: u64,
    is_unique: bool,
    unique_attempt: usize,
    rng: &mut StdRng,
) -> String {
    let base = NaiveDate::from_ymd_opt(2020, 1, 1)
        .expect("valid date")
        .and_hms_opt(0, 0, 0)
        .expect("valid datetime");
    let offset_secs = if is_unique {
        (row_index + unique_attempt as u64) as i64
    } else {
        rng.gen_range(0..=(3650_i64 * 86_400_i64))
    };
    let value = base + Duration::seconds(offset_secs);
    value.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn resolve_integer_bounds(column: &ColumnSchema, rule: Option<&MockColumnRule>) -> (i64, i64) {
    let is_unsigned = column.column_type.to_lowercase().contains("unsigned");
    let default_min = if is_unsigned { 0.0 } else { 1.0 };
    let default_max = if column.data_type.to_lowercase().contains("smallint") {
        32_000.0
    } else {
        1_000_000.0
    };

    let mut min = rule.and_then(|r| r.min).unwrap_or(default_min).round() as i64;
    let mut max = rule.and_then(|r| r.max).unwrap_or(default_max).round() as i64;
    if max < min {
        std::mem::swap(&mut min, &mut max);
    }
    (min, max)
}

fn resolved_text_length(column: &ColumnSchema, rule: Option<&MockColumnRule>) -> usize {
    rule.and_then(|r| r.max_length)
        .or_else(|| parse_type_length(&column.column_type))
        .unwrap_or(DEFAULT_TEXT_LEN)
        .max(4)
}

fn generate_unique_text_value(name: &str, max_len: usize, row_index: u64, unique_attempt: usize) -> String {
    let token = to_base36(u128::from(row_index) + unique_attempt as u128 + 1);
    if token.len() >= max_len {
        return take_last_chars(&token, max_len);
    }

    let prefix_raw = sanitize_identifier(name);
    let prefix = if prefix_raw.is_empty() {
        "v".to_string()
    } else {
        prefix_raw
    };

    let separator = if token.len() + 1 < max_len { "_" } else { "" };
    let prefix_room = max_len.saturating_sub(token.len() + separator.len());
    let prefix_trimmed = prefix.chars().take(prefix_room).collect::<String>();
    format!("{}{}{}", prefix_trimmed, separator, token)
}

fn to_base36(mut value: u128) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while value > 0 {
        let idx = (value % 36) as usize;
        out.push(DIGITS[idx] as char);
        value /= 36;
    }
    out.into_iter().rev().collect()
}

fn take_last_chars(input: &str, max_len: usize) -> String {
    let chars = input.chars().collect::<Vec<char>>();
    if chars.len() <= max_len {
        return input.to_string();
    }
    chars[chars.len() - max_len..].iter().collect()
}

fn parse_type_length(column_type: &str) -> Option<usize> {
    let start = column_type.find('(')?;
    let remainder = &column_type[start + 1..];
    let end = remainder.find(')')?;
    let inside = &remainder[..end];
    inside.split(',').next()?.trim().parse::<usize>().ok()
}

fn sanitize_identifier(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
}

fn truncate_to(mut value: String, max_len: usize) -> String {
    if value.len() <= max_len {
        return value;
    }
    value.truncate(max_len);
    value
}
