use crate::db_types::{ColumnSchema, DatabaseType, TableIndex};
use crate::schema_tracker::models::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MigrationStrategy {
    Native,
    PtOsc,
    GhOst,
    PostgresConcurrently,
}

impl MigrationStrategy {
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "native" => Ok(Self::Native),
            "pt_osc" | "pt-osc" | "ptosc" | "pt_online_schema_change" => Ok(Self::PtOsc),
            "gh_ost" | "gh-ost" | "ghost" => Ok(Self::GhOst),
            "postgres_concurrently" | "concurrently" | "pg_concurrently" => {
                Ok(Self::PostgresConcurrently)
            }
            other => Err(format!("Unknown migration strategy: {}", other)),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::PtOsc => "pt_osc",
            Self::GhOst => "gh_ost",
            Self::PostgresConcurrently => "postgres_concurrently",
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MigrationWarning {
    pub severity: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MigrationPlan {
    pub script: String,
    pub warnings: Vec<MigrationWarning>,
    pub external_commands: Vec<String>,
    pub unsupported_statements: Vec<String>,
    pub strategy: String,
}

#[derive(Debug, Clone)]
struct IndexGroup {
    name: String,
    non_unique: bool,
    columns: Vec<String>,
}

pub fn generate_migration_script(diff: &SchemaDiff, db_type: &DatabaseType) -> String {
    generate_migration_plan(diff, db_type, Some(MigrationStrategy::Native)).script
}

pub fn generate_migration_plan(
    diff: &SchemaDiff,
    db_type: &DatabaseType,
    strategy: Option<MigrationStrategy>,
) -> MigrationPlan {
    let selected_strategy = strategy.unwrap_or(MigrationStrategy::Native);
    let base_statements = build_base_statements(diff, db_type);
    let (final_statements, external_commands, unsupported_statements) =
        apply_strategy(&base_statements, db_type, &selected_strategy);
    let warnings = build_lock_warnings(
        &base_statements,
        db_type,
        &selected_strategy,
        &unsupported_statements,
    );

    let mut script_lines = Vec::new();
    script_lines.push(format!(
        "-- Migration Strategy: {}",
        selected_strategy.as_str()
    ));
    script_lines.push(format!("-- Database Engine: {:?}", db_type));
    if !warnings.is_empty() {
        script_lines.push(format!("-- Lock Warnings: {}", warnings.len()));
    }
    script_lines.push(String::new());

    match selected_strategy {
        MigrationStrategy::PtOsc | MigrationStrategy::GhOst if *db_type == DatabaseType::MySQL => {
            script_lines.push("-- External OSC mode enabled. SQL statements are commented for safety.".to_string());
            script_lines.push(String::new());
            for statement in &base_statements {
                script_lines.push(format!("-- {}", terminate_statement(statement)));
            }

            if !external_commands.is_empty() {
                script_lines.push(String::new());
                script_lines.push("-- Generated External OSC Commands".to_string());
                for command in &external_commands {
                    script_lines.push(command.clone());
                }
            }

            if !unsupported_statements.is_empty() {
                script_lines.push(String::new());
                script_lines.push("-- Unsupported statements for OSC mode".to_string());
                for statement in &unsupported_statements {
                    script_lines.push(format!("-- {}", terminate_statement(statement)));
                }
            }
        }
        _ => {
            for (idx, statement) in final_statements.iter().enumerate() {
                script_lines.push(terminate_statement(statement));
                if idx + 1 < final_statements.len() {
                    script_lines.push(String::new());
                }
            }
        }
    }

    MigrationPlan {
        script: script_lines.join("\n"),
        warnings,
        external_commands,
        unsupported_statements,
        strategy: selected_strategy.as_str().to_string(),
    }
}

fn build_base_statements(diff: &SchemaDiff, db_type: &DatabaseType) -> Vec<String> {
    let mut statements = Vec::new();

    for table in &diff.new_tables {
        statements.push(generate_create_table(table, db_type));
    }

    for table_diff in &diff.modified_tables {
        statements.extend(generate_alter_table(table_diff, db_type));
    }

    for table in &diff.dropped_tables {
        statements.push(format!("DROP TABLE {}", table.name));
    }

    statements
}

fn apply_strategy(
    base_statements: &[String],
    db_type: &DatabaseType,
    strategy: &MigrationStrategy,
) -> (Vec<String>, Vec<String>, Vec<String>) {
    match strategy {
        MigrationStrategy::PostgresConcurrently if *db_type == DatabaseType::PostgreSQL => {
            let final_statements = base_statements
                .iter()
                .map(|statement| apply_postgres_concurrently(statement))
                .collect();
            (final_statements, Vec::new(), Vec::new())
        }
        MigrationStrategy::PtOsc | MigrationStrategy::GhOst if *db_type == DatabaseType::MySQL => {
            let mut external_commands = Vec::new();
            let mut unsupported_statements = Vec::new();

            for statement in base_statements {
                if let Some((table_name, alter_clause)) = extract_alter_table(statement) {
                    let escaped_clause = alter_clause.replace('"', "\\\"");
                    match strategy {
                        MigrationStrategy::PtOsc => external_commands.push(format!(
                            "pt-online-schema-change --alter \"{}\" D=<database>,t={} --execute",
                            escaped_clause, table_name
                        )),
                        MigrationStrategy::GhOst => external_commands.push(format!(
                            "gh-ost --host=\"<host>\" --user=\"<user>\" --database=\"<database>\" --table=\"{}\" --alter=\"{}\" --execute",
                            table_name, escaped_clause
                        )),
                        _ => {}
                    }
                } else {
                    unsupported_statements.push(statement.clone());
                }
            }

            (base_statements.to_vec(), external_commands, unsupported_statements)
        }
        _ => (base_statements.to_vec(), Vec::new(), Vec::new()),
    }
}

fn apply_postgres_concurrently(statement: &str) -> String {
    let trimmed = statement.trim().trim_end_matches(';');
    let upper = trimmed.to_ascii_uppercase();

    if upper.starts_with("CREATE UNIQUE INDEX ") && !upper.contains(" CONCURRENTLY ") {
        return format!(
            "CREATE UNIQUE INDEX CONCURRENTLY {}",
            &trimmed["CREATE UNIQUE INDEX ".len()..]
        );
    }

    if upper.starts_with("CREATE INDEX ") && !upper.contains(" CONCURRENTLY ") {
        return format!("CREATE INDEX CONCURRENTLY {}", &trimmed["CREATE INDEX ".len()..]);
    }

    if upper.starts_with("DROP INDEX ") && !upper.contains(" CONCURRENTLY ") {
        return format!("DROP INDEX CONCURRENTLY {}", &trimmed["DROP INDEX ".len()..]);
    }

    trimmed.to_string()
}

fn extract_alter_table(statement: &str) -> Option<(String, String)> {
    let trimmed = statement.trim().trim_end_matches(';');
    let upper = trimmed.to_ascii_uppercase();
    if !upper.starts_with("ALTER TABLE ") {
        return None;
    }

    let remainder = trimmed["ALTER TABLE ".len()..].trim_start();
    let split_idx = remainder.find(char::is_whitespace)?;
    let table_part = remainder[..split_idx].trim();
    let alter_clause = remainder[split_idx..].trim();

    if alter_clause.is_empty() {
        return None;
    }

    Some((normalize_mysql_table_name(table_part), alter_clause.to_string()))
}

fn normalize_mysql_table_name(raw_table: &str) -> String {
    let cleaned = raw_table
        .trim()
        .trim_matches('`')
        .trim_matches('"')
        .to_string();

    cleaned
        .rsplit('.')
        .next()
        .unwrap_or(cleaned.as_str())
        .trim_matches('`')
        .trim_matches('"')
        .to_string()
}

fn terminate_statement(statement: &str) -> String {
    let trimmed = statement.trim();
    if trimmed.ends_with(';') {
        trimmed.to_string()
    } else {
        format!("{};", trimmed)
    }
}

fn build_lock_warnings(
    statements: &[String],
    db_type: &DatabaseType,
    strategy: &MigrationStrategy,
    unsupported_statements: &[String],
) -> Vec<MigrationWarning> {
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();

    let mut push_warning = |severity: &str, message: &str| {
        if seen.insert(message.to_string()) {
            warnings.push(MigrationWarning {
                severity: severity.to_string(),
                message: message.to_string(),
            });
        }
    };

    if matches!(strategy, MigrationStrategy::PtOsc | MigrationStrategy::GhOst)
        && *db_type == DatabaseType::MySQL
    {
        push_warning(
            "medium",
            "External OSC tools reduce long table locks, but cutover still takes metadata locks.",
        );
    }

    for statement in statements {
        let normalized = statement.replace('\n', " ").to_ascii_uppercase();
        match db_type {
            DatabaseType::PostgreSQL => {
                if normalized.starts_with("CREATE INDEX")
                    || normalized.starts_with("CREATE UNIQUE INDEX")
                {
                    if matches!(strategy, MigrationStrategy::PostgresConcurrently) {
                        push_warning(
                            "low",
                            "CREATE INDEX CONCURRENTLY is safer online but still takes brief metadata locks.",
                        );
                    } else {
                        push_warning(
                            "high",
                            "CREATE INDEX without CONCURRENTLY may block writes on busy PostgreSQL tables.",
                        );
                    }
                } else if normalized.starts_with("DROP INDEX") {
                    if matches!(strategy, MigrationStrategy::PostgresConcurrently) {
                        push_warning(
                            "low",
                            "DROP INDEX CONCURRENTLY avoids long blocking, but final catalog lock is still required briefly.",
                        );
                    } else {
                        push_warning(
                            "medium",
                            "DROP INDEX without CONCURRENTLY can block concurrent activity.",
                        );
                    }
                } else if normalized.starts_with("ALTER TABLE")
                    && (normalized.contains("DROP COLUMN")
                        || normalized.contains("ALTER COLUMN")
                        || normalized.contains(" TYPE ")
                        || normalized.contains("SET NOT NULL"))
                {
                    push_warning(
                        "high",
                        "ALTER TABLE modifications may acquire ACCESS EXCLUSIVE lock in PostgreSQL.",
                    );
                }
            }
            DatabaseType::MySQL => {
                if normalized.starts_with("ALTER TABLE") {
                    if matches!(strategy, MigrationStrategy::PtOsc | MigrationStrategy::GhOst) {
                        push_warning(
                            "medium",
                            "ALTER TABLE is planned via external OSC tool; validate cutover window.",
                        );
                    } else if normalized.contains("DROP COLUMN")
                        || normalized.contains("MODIFY COLUMN")
                        || normalized.contains("CHANGE COLUMN")
                    {
                        push_warning(
                            "high",
                            "MySQL column changes may hold metadata locks and stall writes.",
                        );
                    } else {
                        push_warning(
                            "medium",
                            "MySQL ALTER TABLE can cause metadata lock waits under load.",
                        );
                    }
                } else if normalized.starts_with("DROP TABLE") {
                    push_warning(
                        "high",
                        "DROP TABLE is destructive and can block dependent workloads.",
                    );
                }
            }
            DatabaseType::ClickHouse => {
                // ClickHouse specific warnings can be added here
            }
            DatabaseType::Disconnected => {}
        }
    }

    if !unsupported_statements.is_empty() {
        push_warning(
            "high",
            "Some statements are not compatible with selected external OSC mode and require manual handling.",
        );
    }

    warnings
}

fn generate_create_table(table: &TableDefinition, db_type: &DatabaseType) -> String {
    let mut columns_def = Vec::new();
    for col in &table.columns {
        let col_def = match db_type {
            DatabaseType::MySQL => format_column_mysql(col),
            DatabaseType::PostgreSQL => format_column_postgres(col),
            DatabaseType::ClickHouse => format_column_mysql(col), // ClickHouse via MySQL bridge
            DatabaseType::Disconnected => String::new(),
        };
        columns_def.push(col_def);
    }

    let pk_cols: Vec<String> = table
        .primary_keys
        .iter()
        .map(|pk| pk.column_name.clone())
        .collect();
    
    match db_type {
        DatabaseType::PostgreSQL | DatabaseType::MySQL => {
            if !pk_cols.is_empty() {
                columns_def.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
            }
            format!(
                "CREATE TABLE {} (\n    {}\n)",
                table.name,
                columns_def.join(",\n    ")
            )
        }
        DatabaseType::ClickHouse => {
            // ClickHouse needs ENGINE
            format!(
                "CREATE TABLE {} (\n    {}\n) ENGINE = MergeTree() ORDER BY ({})",
                table.name,
                columns_def.join(",\n    "),
                if pk_cols.is_empty() { "tuple()".to_string() } else { pk_cols.join(", ") }
            )
        }
        DatabaseType::Disconnected => String::new(),
    }
}

fn generate_alter_table(diff: &TableDiff, db_type: &DatabaseType) -> Vec<String> {
    let mut stmts = Vec::new();
    let table = &diff.table_name;

    for col in &diff.new_columns {
        match db_type {
            DatabaseType::MySQL => stmts.push(format!(
                "ALTER TABLE {} ADD COLUMN {}",
                table,
                format_column_mysql(col)
            )),
            DatabaseType::PostgreSQL => stmts.push(format!(
                "ALTER TABLE {} ADD COLUMN {}",
                table,
                format_column_postgres(col)
            )),
            DatabaseType::ClickHouse => stmts.push(format!(
                "ALTER TABLE {} ADD COLUMN {}",
                table,
                format_column_mysql(col)
            )),
            DatabaseType::Disconnected => {}
        }
    }

    for col in &diff.dropped_columns {
        stmts.push(format!("ALTER TABLE {} DROP COLUMN {}", table, col.name));
    }

    for col_diff in &diff.modified_columns {
        match db_type {
            DatabaseType::MySQL => stmts.push(format!(
                "ALTER TABLE {} MODIFY COLUMN {}",
                table,
                format_column_mysql(&col_diff.new_column)
            )),
            DatabaseType::PostgreSQL => {
                let mut changes = Vec::new();
                for change in &col_diff.changes {
                    match change {
                        DiffType::TypeChanged { .. } => {
                            changes.push(format!(
                                "ALTER COLUMN {} TYPE {} USING {}::{}",
                                col_diff.column_name,
                                col_diff.new_column.column_type,
                                col_diff.column_name,
                                col_diff.new_column.column_type
                            ));
                        }
                        DiffType::NullableChanged { new, .. } => {
                            if *new {
                                changes.push(format!(
                                    "ALTER COLUMN {} DROP NOT NULL",
                                    col_diff.column_name
                                ));
                            } else {
                                changes.push(format!(
                                    "ALTER COLUMN {} SET NOT NULL",
                                    col_diff.column_name
                                ));
                            }
                        }
                        DiffType::DefaultChanged { new, .. } => {
                            if let Some(def) = new {
                                changes.push(format!(
                                    "ALTER COLUMN {} SET DEFAULT {}",
                                    col_diff.column_name, def
                                ));
                            } else {
                                changes.push(format!(
                                    "ALTER COLUMN {} DROP DEFAULT",
                                    col_diff.column_name
                                ));
                            }
                        }
                        _ => {}
                    }
                }
                for change in changes {
                    stmts.push(format!("ALTER TABLE {} {}", table, change));
                }
            }
            DatabaseType::ClickHouse => stmts.push(format!(
                "ALTER TABLE {} MODIFY COLUMN {}",
                table,
                format_column_mysql(&col_diff.new_column)
            )),
            DatabaseType::Disconnected => {}
        }
    }

    for idx in group_indexes_by_name(&diff.new_indexes) {
        if idx.name.eq_ignore_ascii_case("PRIMARY") || idx.columns.is_empty() {
            continue;
        }
        let unique_part = if idx.non_unique { "" } else { "UNIQUE " };
        let columns = idx.columns.join(", ");
        stmts.push(format!(
            "CREATE {}INDEX {} ON {} ({})",
            unique_part, idx.name, table, columns
        ));
    }

    for idx in group_indexes_by_name(&diff.dropped_indexes) {
        if idx.name.eq_ignore_ascii_case("PRIMARY") {
            continue;
        }
        match db_type {
            DatabaseType::MySQL => stmts.push(format!("DROP INDEX {} ON {}", idx.name, table)),
            DatabaseType::PostgreSQL => stmts.push(format!("DROP INDEX {}", idx.name)),
            DatabaseType::ClickHouse => stmts.push(format!("ALTER TABLE {} DROP INDEX {}", table, idx.name)),
            DatabaseType::Disconnected => {}
        }
    }

    stmts
}

fn group_indexes_by_name(indexes: &[TableIndex]) -> Vec<IndexGroup> {
    let mut grouped: BTreeMap<String, IndexGroup> = BTreeMap::new();

    for idx in indexes {
        let entry = grouped
            .entry(idx.name.clone())
            .or_insert_with(|| IndexGroup {
                name: idx.name.clone(),
                non_unique: idx.non_unique,
                columns: Vec::new(),
            });

        if !entry
            .columns
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&idx.column_name))
        {
            entry.columns.push(idx.column_name.clone());
        }

        if !idx.non_unique {
            entry.non_unique = false;
        }
    }

    grouped.into_values().collect()
}

fn format_column_mysql(col: &ColumnSchema) -> String {
    let null_def = if col.is_nullable { "NULL" } else { "NOT NULL" };
    let default_def = if let Some(ref def) = col.column_default {
        format!("DEFAULT {}", def)
    } else {
        String::new()
    };

    format!(
        "{} {} {} {}",
        col.name, col.column_type, null_def, default_def
    )
}

fn format_column_postgres(col: &ColumnSchema) -> String {
    let null_def = if col.is_nullable { "NULL" } else { "NOT NULL" };
    let default_def = if let Some(ref def) = col.column_default {
        format!("DEFAULT {}", def)
    } else {
        String::new()
    };

    format!(
        "{} {} {} {}",
        col.name, col.column_type, null_def, default_def
    )
}
