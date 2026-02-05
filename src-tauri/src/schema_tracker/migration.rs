use crate::db_types::{ColumnSchema, DatabaseType};
use crate::schema_tracker::models::*;

pub fn generate_migration_script(diff: &SchemaDiff, db_type: &DatabaseType) -> String {
    let mut script = String::new();

    // 1. New Tables
    for table in &diff.new_tables {
        let create_stmt = generate_create_table(table, db_type);
        script.push_str(&create_stmt);
        script.push_str("\n\n");
    }

    // 2. Modified Tables
    for table_diff in &diff.modified_tables {
        let alter_vmts = generate_alter_table(table_diff, db_type);
        for stmt in alter_vmts {
            script.push_str(&stmt);
            script.push_str(";\n");
        }
        if !diff.modified_tables.is_empty() {
            script.push('\n');
        }
    }

    // 3. Dropped Tables
    for table in &diff.dropped_tables {
        script.push_str(&format!("DROP TABLE {};", table.name));
        script.push_str("\n\n");
    }

    script
}

fn generate_create_table(table: &TableDefinition, db_type: &DatabaseType) -> String {
    // Use existing DDL generation logic or reconstruct it
    // For MVP, we reconstruct basic CREATE TABLE
    let mut columns_def = Vec::new();
    for col in &table.columns {
        let col_def = match db_type {
            DatabaseType::MySQL => format_column_mysql(col),
            DatabaseType::PostgreSQL => format_column_postgres(col),
            DatabaseType::Disconnected => String::new(),
        };
        columns_def.push(col_def);
    }

    // PKs
    let pk_cols: Vec<String> = table
        .primary_keys
        .iter()
        .map(|pk| pk.column_name.clone())
        .collect();
    if !pk_cols.is_empty() {
        columns_def.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
    }

    format!(
        "CREATE TABLE {} (\n    {}\n);",
        table.name,
        columns_def.join(",\n    ")
    )
}

fn generate_alter_table(diff: &TableDiff, db_type: &DatabaseType) -> Vec<String> {
    let mut stmts = Vec::new();
    let table = &diff.table_name;

    // Add Columns
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
            DatabaseType::Disconnected => {}
        }
    }

    // Drop Columns
    for col in &diff.dropped_columns {
        stmts.push(format!("ALTER TABLE {} DROP COLUMN {}", table, col.name));
    }

    // Modify Columns
    for col_diff in &diff.modified_columns {
        match db_type {
            DatabaseType::MySQL => stmts.push(format!(
                "ALTER TABLE {} MODIFY COLUMN {}",
                table,
                format_column_mysql(&col_diff.new_column)
            )),
            DatabaseType::PostgreSQL => {
                // Postgres ALTER COLUMN TYPE
                // Check if type changed
                let mut changes = Vec::new();
                for change in &col_diff.changes {
                    match change {
                        DiffType::TypeChanged { .. } => {
                            changes.push(format!(
                                "ALTER COLUMN {} TYPE {} USING {}::{}",
                                col_diff.column_name,
                                col_diff.new_column.data_type,
                                col_diff.column_name,
                                col_diff.new_column.data_type
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
            DatabaseType::Disconnected => {}
        }
    }

    stmts
}

fn format_column_mysql(col: &ColumnSchema) -> String {
    let null_def = if col.is_nullable { "NULL" } else { "NOT NULL" };
    let default_def = if let Some(ref def) = col.column_default {
        format!("DEFAULT {}", def) // Simplistic, assumes quoting is handled or raw value
    } else {
        String::new()
    };

    // Reconstruct type
    // If we have full_type in 'column_type' field (from capture), use it.
    // Assuming 'column_type' holds e.g. "varchar(255)"

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
