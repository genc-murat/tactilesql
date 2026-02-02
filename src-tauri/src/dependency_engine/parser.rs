use sqlparser::dialect::{MySqlDialect, PostgreSqlDialect, Dialect};
use sqlparser::parser::Parser;
use sqlparser::ast::{Statement, TableFactor, SetExpr, TableWithJoins, Select};

use super::graph::{EdgeType, SchemaQualifiedName};

pub enum DbDialect {
    MySQL,
    PostgreSQL,
}

pub struct ParsingResult {
    pub dependencies: Vec<(SchemaQualifiedName, EdgeType)>,
}

pub fn extract_dependencies(sql: &str, dialect_type: DbDialect) -> ParsingResult {
    let dialect: Box<dyn Dialect> = match dialect_type {
        DbDialect::MySQL => Box::new(MySqlDialect {}),
        DbDialect::PostgreSQL => Box::new(PostgreSqlDialect {}),
    };

    let ast = Parser::parse_sql(&*dialect, sql);
    let mut dependencies = Vec::new();
    
    if let Ok(statements) = ast {
        for statement in statements {
            visit_statement(&statement, &mut dependencies);
        }
    } else {
        // Fallback: Regex extraction
        extract_regex(sql, &mut dependencies);
    }

    ParsingResult {
        dependencies,
    }
}

fn visit_statement(stmt: &Statement, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    match stmt {
        Statement::CreateView { query, .. } => {
            visit_query(query, deps);
        },
        Statement::Insert(sqlparser::ast::Insert { source, .. }) => {
            if let Some(query) = source {
                visit_query(query, deps);
            }
        },
        Statement::Query(query) => {
            visit_query(query, deps);
        },
        _ => {}
    }
}

fn visit_query(query: &sqlparser::ast::Query, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    visit_set_expr(&query.body, deps);
}

fn visit_set_expr(expr: &SetExpr, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    match expr {
        SetExpr::Select(select) => visit_select(select, deps),
        SetExpr::Query(query) => visit_query(query, deps),
        SetExpr::SetOperation { left, right, .. } => {
            visit_set_expr(left, deps);
            visit_set_expr(right, deps);
        },
        _ => {}
    }
}

fn visit_select(select: &Select, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    for table_with_joins in &select.from {
        visit_table_with_joins(table_with_joins, deps);
    }
}

fn visit_table_with_joins(table: &TableWithJoins, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    visit_table_factor(&table.relation, deps);
    for join in &table.joins {
        visit_table_factor(&join.relation, deps);
    }
}

fn visit_table_factor(factor: &TableFactor, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    match factor {
        TableFactor::Table { name, .. } => {
            let parts: Vec<String> = name.0.iter().map(|i| i.value.clone()).collect();
                
            let (schema, table_name) = if parts.len() > 1 {
                (Some(parts[0].clone()), parts[1].clone())
            } else {
                (None, parts[0].clone())
            };
            
            deps.push((
                SchemaQualifiedName::new(schema, table_name),
                EdgeType::Select 
            ));
        },
        TableFactor::Derived { subquery, .. } => {
            visit_query(subquery, deps);
        },
        TableFactor::NestedJoin { table_with_joins, .. } => {
            visit_table_with_joins(table_with_joins, deps);
        },
        _ => {}
    }
}

fn extract_regex(sql: &str, results: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    let re = regex::Regex::new(r"(?i)\s+(?:FROM|JOIN|UPDATE|INTO)\s+([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?").unwrap();
    
    for cap in re.captures_iter(sql) {
        let p1 = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
        let p2 = cap.get(2).map(|m| m.as_str().to_string());
        
        let (schema, name) = if let Some(part2) = p2 {
            (Some(p1), part2)
        } else {
            (None, p1)
        };
        
        // Make sure it's not a keyword
        let upper = name.to_uppercase();
        if ["SELECT", "WHERE", "GROUP", "ORDER", "LIMIT", "LATERAL"].contains(&upper.as_str()) {
             continue;
        }

        results.push((SchemaQualifiedName::new(schema, name), EdgeType::Unknown));
    }
}

