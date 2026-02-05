use sqlparser::ast::{
    Delete, Expr, FromTable, Function, FunctionArg, FunctionArgExpr, FunctionArguments, ObjectName,
    Select, SetExpr, Statement, TableFactor, TableWithJoins,
};
use sqlparser::dialect::{Dialect, MySqlDialect, PostgreSqlDialect};
use sqlparser::parser::Parser;

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

        // Routine bodies are sometimes hard to parse completely, so keep a typed
        // regex fallback when AST traversal found nothing useful.
        if dependencies.is_empty() {
            extract_regex(sql, &mut dependencies);
        }
    } else {
        extract_regex(sql, &mut dependencies);
    }

    ParsingResult { dependencies }
}

fn visit_statement(stmt: &Statement, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    match stmt {
        Statement::CreateView { query, .. } => visit_query(query, deps),
        Statement::CreateProcedure { body, .. } => {
            for nested in body {
                visit_statement(nested, deps);
            }
        }
        Statement::Insert(insert) => {
            push_dependency_from_object_name(&insert.table_name, EdgeType::Insert, deps);

            if let Some(query) = &insert.source {
                visit_query(query, deps);
            }
        }
        Statement::Update { table, from, .. } => {
            visit_table_factor_with_edge(&table.relation, EdgeType::Update, deps);

            // JOIN/FROM sources inside UPDATE are reads.
            for join in &table.joins {
                visit_table_factor_with_edge(&join.relation, EdgeType::Select, deps);
            }
            if let Some(from_table) = from {
                visit_table_with_joins_with_edge(from_table, EdgeType::Select, deps);
            }
        }
        Statement::Delete(delete) => visit_delete(delete, deps),
        Statement::Call(function) => visit_call(function, deps),
        Statement::Query(query) => visit_query(query, deps),
        Statement::CreateFunction { function_body, .. } => {
            if let Some(body_expr) = function_body {
                visit_function_body_expr(body_expr, deps);
            }
        }
        _ => {}
    }
}

fn visit_function_body_expr(
    body: &sqlparser::ast::CreateFunctionBody,
    deps: &mut Vec<(SchemaQualifiedName, EdgeType)>,
) {
    match body {
        sqlparser::ast::CreateFunctionBody::AsBeforeOptions(expr)
        | sqlparser::ast::CreateFunctionBody::AsAfterOptions(expr)
        | sqlparser::ast::CreateFunctionBody::Return(expr) => {
            visit_expr_for_subquery(expr, deps);
        }
    }
}

fn visit_expr_for_subquery(expr: &Expr, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    match expr {
        Expr::Subquery(query) => visit_query(query, deps),
        Expr::Exists { subquery, .. } => visit_query(subquery, deps),
        Expr::InSubquery { subquery, .. } => visit_query(subquery, deps),
        Expr::BinaryOp { left, right, .. } => {
            visit_expr_for_subquery(left, deps);
            visit_expr_for_subquery(right, deps);
        }
        Expr::UnaryOp { expr, .. }
        | Expr::Nested(expr)
        | Expr::IsNull(expr)
        | Expr::IsNotNull(expr)
        | Expr::IsTrue(expr)
        | Expr::IsNotTrue(expr)
        | Expr::IsFalse(expr)
        | Expr::IsNotFalse(expr)
        | Expr::IsUnknown(expr)
        | Expr::IsNotUnknown(expr)
        | Expr::Cast { expr, .. }
        | Expr::AtTimeZone { timestamp: expr, .. }
        | Expr::Extract { expr, .. } => {
            visit_expr_for_subquery(expr, deps);
        }
        Expr::Between {
            expr, low, high, ..
        } => {
            visit_expr_for_subquery(expr, deps);
            visit_expr_for_subquery(low, deps);
            visit_expr_for_subquery(high, deps);
        }
        Expr::Case {
            operand,
            conditions,
            results,
            else_result,
        } => {
            if let Some(operand) = operand {
                visit_expr_for_subquery(operand, deps);
            }
            for condition in conditions {
                visit_expr_for_subquery(condition, deps);
            }
            for result in results {
                visit_expr_for_subquery(result, deps);
            }
            if let Some(else_result) = else_result {
                visit_expr_for_subquery(else_result, deps);
            }
        }
        Expr::Function(function) => {
            visit_function_arguments(&function.parameters, deps);
            visit_function_arguments(&function.args, deps);
            if let Some(filter_expr) = &function.filter {
                visit_expr_for_subquery(filter_expr, deps);
            }
        }
        _ => {}
    }
}

fn visit_function_arguments(args: &FunctionArguments, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    match args {
        FunctionArguments::None => {}
        FunctionArguments::Subquery(query) => visit_query(query, deps),
        FunctionArguments::List(list) => {
            for arg in &list.args {
                match arg {
                    FunctionArg::Unnamed(FunctionArgExpr::Expr(expr)) => {
                        visit_expr_for_subquery(expr, deps);
                    }
                    FunctionArg::Named {
                        arg: FunctionArgExpr::Expr(expr),
                        ..
                    } => {
                        visit_expr_for_subquery(expr, deps);
                    }
                    _ => {}
                }
            }
        }
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
        }
        _ => {}
    }
}

fn visit_select(select: &Select, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    for table_with_joins in &select.from {
        visit_table_with_joins_with_edge(table_with_joins, EdgeType::Select, deps);
    }
}

fn visit_delete(delete: &Delete, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    let from_tables = match &delete.from {
        FromTable::WithFromKeyword(tables) => tables,
        FromTable::WithoutKeyword(tables) => tables,
    };

    for table in from_tables {
        visit_table_factor_with_edge(&table.relation, EdgeType::Delete, deps);
        for join in &table.joins {
            visit_table_factor_with_edge(&join.relation, EdgeType::Select, deps);
        }
    }

    if let Some(using_tables) = &delete.using {
        for table in using_tables {
            visit_table_with_joins_with_edge(table, EdgeType::Select, deps);
        }
    }
}

fn visit_call(function: &Function, deps: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    push_dependency_from_object_name(&function.name, EdgeType::Call, deps);
}

fn visit_table_with_joins_with_edge(
    table: &TableWithJoins,
    edge_type: EdgeType,
    deps: &mut Vec<(SchemaQualifiedName, EdgeType)>,
) {
    visit_table_factor_with_edge(&table.relation, edge_type.clone(), deps);
    for join in &table.joins {
        visit_table_factor_with_edge(&join.relation, edge_type.clone(), deps);
    }
}

fn visit_table_factor_with_edge(
    factor: &TableFactor,
    edge_type: EdgeType,
    deps: &mut Vec<(SchemaQualifiedName, EdgeType)>,
) {
    match factor {
        TableFactor::Table { name, .. } => {
            push_dependency_from_object_name(name, edge_type, deps);
        }
        TableFactor::Derived { subquery, .. } => {
            visit_query(subquery, deps);
        }
        TableFactor::NestedJoin { table_with_joins, .. } => {
            visit_table_with_joins_with_edge(table_with_joins, edge_type, deps);
        }
        _ => {}
    }
}

fn push_dependency_from_object_name(
    name: &ObjectName,
    edge_type: EdgeType,
    deps: &mut Vec<(SchemaQualifiedName, EdgeType)>,
) {
    let parts: Vec<String> = name.0.iter().map(|ident| ident.value.clone()).collect();
    let Some(object_name) = parts.last() else {
        return;
    };

    let schema = if parts.len() >= 2 {
        parts.get(parts.len() - 2).cloned()
    } else {
        None
    };

    deps.push((
        SchemaQualifiedName::new(schema, object_name.clone()),
        edge_type,
    ));
}

fn parse_captured_identifier(raw_part1: &str, raw_part2: Option<&str>) -> Option<SchemaQualifiedName> {
    let part1 = raw_part1.trim();
    if part1.is_empty() {
        return None;
    }

    let (schema, name) = if let Some(part2) = raw_part2 {
        (Some(part1.to_string()), part2.trim().to_string())
    } else {
        (None, part1.to_string())
    };

    if name.is_empty() {
        return None;
    }

    let upper = name.to_uppercase();
    if [
        "SELECT",
        "WHERE",
        "GROUP",
        "ORDER",
        "LIMIT",
        "LATERAL",
        "SET",
        "VALUES",
        "RETURNING",
    ]
    .contains(&upper.as_str())
    {
        return None;
    }

    Some(SchemaQualifiedName::new(schema, name))
}

fn push_regex_matches(
    sql: &str,
    pattern: &str,
    edge_type: EdgeType,
    results: &mut Vec<(SchemaQualifiedName, EdgeType)>,
) {
    let re = regex::Regex::new(pattern).expect("invalid dependency regex");
    for cap in re.captures_iter(sql) {
        let raw_part1 = cap.get(1).map(|m| m.as_str()).unwrap_or_default();
        let raw_part2 = cap.get(2).map(|m| m.as_str());
        if let Some(name) = parse_captured_identifier(raw_part1, raw_part2) {
            results.push((name, edge_type.clone()));
        }
    }
}

fn extract_regex(sql: &str, results: &mut Vec<(SchemaQualifiedName, EdgeType)>) {
    push_regex_matches(
        sql,
        r"(?i)\b(?:FROM|JOIN)\s+([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?",
        EdgeType::Select,
        results,
    );
    push_regex_matches(
        sql,
        r"(?i)\bINSERT\s+INTO\s+([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?",
        EdgeType::Insert,
        results,
    );
    push_regex_matches(
        sql,
        r"(?i)\bUPDATE\s+([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?",
        EdgeType::Update,
        results,
    );
    push_regex_matches(
        sql,
        r"(?i)\bDELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?",
        EdgeType::Delete,
        results,
    );
    push_regex_matches(
        sql,
        r"(?i)\bCALL\s+([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?",
        EdgeType::Call,
        results,
    );
}
