use super::*;
use sqlx::{MySql, Pool};

pub async fn analyze_impact_mysql(
    _pool: &Pool<MySql>,
    _database: &str,
    _table: &str,
) -> Result<ImpactGraph, String> {
    Ok(ImpactGraph {
        nodes: Vec::new(),
        edges: Vec::new(),
    })
}
