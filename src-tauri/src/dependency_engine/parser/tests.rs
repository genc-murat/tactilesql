use super::*;
use crate::dependency_engine::graph::EdgeType;

#[test]
fn test_extract_dependencies_select() {
    let sql = "SELECT * FROM users JOIN orders ON users.id = orders.user_id";
    let res = extract_dependencies(sql, DbDialect::PostgreSQL);

    let tables: Vec<String> = res
        .dependencies
        .iter()
        .map(|(n, _)| n.name.clone())
        .collect();
    assert!(tables.contains(&"users".to_string()));
    assert!(tables.contains(&"orders".to_string()));
    assert!(res
        .dependencies
        .iter()
        .all(|(_, t)| matches!(t, EdgeType::Select)));
}

#[test]
fn test_extract_dependencies_insert() {
    let sql = "INSERT INTO audit_log SELECT * FROM users";
    let res = extract_dependencies(sql, DbDialect::MySQL);

    let insert_dep = res
        .dependencies
        .iter()
        .find(|(n, _)| n.name == "audit_log")
        .unwrap();
    assert!(matches!(insert_dep.1, EdgeType::Insert));

    let select_dep = res
        .dependencies
        .iter()
        .find(|(n, _)| n.name == "users")
        .unwrap();
    assert!(matches!(select_dep.1, EdgeType::Select));
}

#[test]
fn test_extract_dependencies_regex_fallback() {
    // A non-standard SQL that might fail AST parser but should be caught by regex
    let sql = "EXECUTE some_proc FROM weird_table";
    let res = extract_dependencies(sql, DbDialect::PostgreSQL);

    let tables: Vec<String> = res
        .dependencies
        .iter()
        .map(|(n, _)| n.name.clone())
        .collect();
    assert!(tables.contains(&"weird_table".to_string()));
}

#[test]
fn test_extract_dependencies_cte() {
    let sql = "WITH regional_sales AS (
        SELECT region, SUM(amount) AS total_sales
        FROM orders
        GROUP BY region
    )
    SELECT * FROM regional_sales WHERE total_sales > 100";

    let res = extract_dependencies(sql, DbDialect::PostgreSQL);
    let tables: Vec<String> = res
        .dependencies
        .iter()
        .map(|(n, _)| n.name.clone())
        .collect();

    // orders should be detected
    assert!(tables.contains(&"orders".to_string()));
    // regional_sales is a CTE, it might or might not be in dependencies depending on parser implementation
    // Standard behavior: skip CTEs as they aren't persistent tables
}

#[test]
fn test_extract_dependencies_subquery() {
    let sql = "SELECT name FROM users WHERE id IN (SELECT user_id FROM favorites)";
    let res = extract_dependencies(sql, DbDialect::MySQL);
    let tables: Vec<String> = res
        .dependencies
        .iter()
        .map(|(n, _)| n.name.clone())
        .collect();

    assert!(tables.contains(&"users".to_string()));
    assert!(tables.contains(&"favorites".to_string()));
}
