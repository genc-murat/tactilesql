use super::*;
use sqlx::{Postgres, Pool};

pub async fn analyze_impact_postgres(
    _pool: &Pool<Postgres>,
    _database: &str,
    _table: &str,
) -> Result<ImpactGraph, String> {
    Ok(ImpactGraph {
        nodes: Vec::new(),
        edges: Vec::new(),
    })
}
