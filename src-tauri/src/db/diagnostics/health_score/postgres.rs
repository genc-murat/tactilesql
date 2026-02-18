use crate::db_types::{HealthCategory, HealthMetricDetail};
use sqlx::{Pool, Postgres};

pub struct PostgresHealthConfig {
    pub perf_weight: f32,
    pub conn_weight: f32,
    pub stor_weight: f32,
    pub maint_weight: f32,
    pub sec_weight: f32,
}

impl Default for PostgresHealthConfig {
    fn default() -> Self {
        Self {
            perf_weight: 0.30,
            conn_weight: 0.15,
            stor_weight: 0.25,
            maint_weight: 0.20,
            sec_weight: 0.10,
        }
    }
}

pub async fn collect_postgres_health_metrics(
    pool: &Pool<Postgres>,
    config: &PostgresHealthConfig,
) -> Result<Vec<HealthCategory>, String> {
    let performance = collect_performance_metrics(pool).await?;
    let connections = collect_connection_metrics(pool).await?;
    let storage = collect_storage_metrics(pool).await?;
    let maintenance = collect_maintenance_metrics(pool).await?;
    let security = collect_security_metrics(pool).await?;
    
    Ok(vec![
        HealthCategory {
            id: "performance".to_string(),
            name: "Performance".to_string(),
            score: super::scoring::calculate_category_score(&performance.metrics),
            status: get_category_status(&performance.metrics),
            weight: config.perf_weight,
            metrics: performance.metrics,
            icon: "speed".to_string(),
        },
        HealthCategory {
            id: "connections".to_string(),
            name: "Connections".to_string(),
            score: super::scoring::calculate_category_score(&connections.metrics),
            status: get_category_status(&connections.metrics),
            weight: config.conn_weight,
            metrics: connections.metrics,
            icon: "link".to_string(),
        },
        HealthCategory {
            id: "storage".to_string(),
            name: "Storage".to_string(),
            score: super::scoring::calculate_category_score(&storage.metrics),
            status: get_category_status(&storage.metrics),
            weight: config.stor_weight,
            metrics: storage.metrics,
            icon: "storage".to_string(),
        },
        HealthCategory {
            id: "maintenance".to_string(),
            name: "Maintenance".to_string(),
            score: super::scoring::calculate_category_score(&maintenance.metrics),
            status: get_category_status(&maintenance.metrics),
            weight: config.maint_weight,
            metrics: maintenance.metrics,
            icon: "build".to_string(),
        },
        HealthCategory {
            id: "security".to_string(),
            name: "Security".to_string(),
            score: super::scoring::calculate_category_score(&security.metrics),
            status: get_category_status(&security.metrics),
            weight: config.sec_weight,
            metrics: security.metrics,
            icon: "lock".to_string(),
        },
    ])
}

struct CategoryResult {
    metrics: Vec<HealthMetricDetail>,
}

fn get_category_status(metrics: &[HealthMetricDetail]) -> String {
    if metrics.iter().any(|m| m.status == "critical") {
        "critical"
    } else if metrics.iter().any(|m| m.status == "warning") {
        "warning"
    } else {
        "healthy"
    }.to_string()
}

async fn collect_performance_metrics(pool: &Pool<Postgres>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let cache_stats: Option<(i64, i64)> = sqlx::query_as(
        "SELECT 
            COALESCE(SUM(blks_hit), 0)::bigint,
            COALESCE(SUM(blks_read), 0)::bigint
        FROM pg_stat_database 
        WHERE datname IS NOT NULL"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch cache stats: {}", e))?;
    
    let (blks_hit, blks_read) = cache_stats.unwrap_or((0, 0));
    let total = blks_hit + blks_read;
    let cache_hit_ratio = if total > 0 {
        (blks_hit as f64 / total as f64) * 100.0
    } else {
        100.0
    };
    
    metrics.push(HealthMetricDetail {
        id: "perf_cache_hit".to_string(),
        label: "Cache Hit Ratio".to_string(),
        value: format!("{:.1}%", cache_hit_ratio),
        raw_value: cache_hit_ratio,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(cache_hit_ratio, 95.0, 85.0, false),
        weight: 0.35,
        threshold_warning: 95.0,
        threshold_critical: 85.0,
        description: Some("Buffer cache hit ratio from pg_stat_database".to_string()),
    });
    
    let index_stats: Option<(i64, i64)> = sqlx::query_as(
        "SELECT 
            COALESCE(SUM(idx_scan), 0)::bigint,
            COALESCE(SUM(seq_scan), 0)::bigint
        FROM pg_stat_user_tables"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch index stats: {}", e))?;
    
    let (idx_scans, seq_scans) = index_stats.unwrap_or((0, 0));
    let total_scans = idx_scans + seq_scans;
    let index_usage_ratio = if total_scans > 0 {
        (idx_scans as f64 / total_scans as f64) * 100.0
    } else {
        100.0
    };
    
    metrics.push(HealthMetricDetail {
        id: "perf_index_usage".to_string(),
        label: "Index Usage Ratio".to_string(),
        value: format!("{:.1}%", index_usage_ratio),
        raw_value: index_usage_ratio,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(index_usage_ratio, 90.0, 70.0, false),
        weight: 0.25,
        threshold_warning: 90.0,
        threshold_critical: 70.0,
        description: Some("Ratio of index scans to sequential scans".to_string()),
    });
    
    let dead_tuples: Option<(i64, i64)> = sqlx::query_as(
        "SELECT 
            COALESCE(SUM(n_dead_tup), 0)::bigint,
            COALESCE(SUM(n_live_tup), 0)::bigint
        FROM pg_stat_user_tables"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch tuple stats: {}", e))?;
    
    let (dead_tup, live_tup) = dead_tuples.unwrap_or((0, 0));
    let total_tup = dead_tup + live_tup;
    let dead_tuple_ratio = if total_tup > 0 {
        (dead_tup as f64 / total_tup as f64) * 100.0
    } else {
        0.0
    };
    
    metrics.push(HealthMetricDetail {
        id: "perf_dead_tuples".to_string(),
        label: "Dead Tuples Ratio".to_string(),
        value: format!("{:.1}%", dead_tuple_ratio),
        raw_value: dead_tuple_ratio,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(dead_tuple_ratio, 10.0, 25.0, true),
        weight: 0.20,
        threshold_warning: 10.0,
        threshold_critical: 25.0,
        description: Some(format!("{} dead / {} live tuples", dead_tup, live_tup)),
    });
    
    let temp_files: Option<(i64,)> = sqlx::query_as(
        "SELECT COALESCE(SUM(temp_files), 0)::bigint FROM pg_stat_database WHERE datname IS NOT NULL"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch temp files: {}", e))?;
    
    let temp_count = temp_files.map(|(t,)| t).unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_temp_files".to_string(),
        label: "Temp Files Created".to_string(),
        value: format!("{}", temp_count),
        raw_value: temp_count as f64,
        unit: None,
        status: super::scoring::get_status(temp_count as f64, 1000.0, 10000.0, true),
        weight: 0.20,
        threshold_warning: 1000.0,
        threshold_critical: 10000.0,
        description: Some("Temporary files created (indicates work_mem issues)".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_connection_metrics(pool: &Pool<Postgres>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let max_conn: Option<(String,)> = sqlx::query_as(
        "SELECT setting FROM pg_settings WHERE name = 'max_connections'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch max_connections: {}", e))?;
    
    let max_connections: i64 = max_conn
        .and_then(|(s,)| s.parse().ok())
        .unwrap_or(100);
    
    let conn_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_stat_activity WHERE datname IS NOT NULL"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count connections: {}", e))?;
    
    let active_count = conn_count.0;
    let conn_usage = (active_count as f64 / max_connections as f64) * 100.0;
    
    metrics.push(HealthMetricDetail {
        id: "conn_usage".to_string(),
        label: "Connection Usage".to_string(),
        value: format!("{}/{}", active_count, max_connections),
        raw_value: conn_usage,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(conn_usage, 70.0, 90.0, true),
        weight: 0.40,
        threshold_warning: 70.0,
        threshold_critical: 90.0,
        description: Some(format!("Using {:.1}% of max connections", conn_usage)),
    });
    
    let idle_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_stat_activity WHERE state = 'idle' AND query_start < NOW() - INTERVAL '5 minutes'"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count idle connections: {}", e))?;
    
    let idle_conns = idle_count.0;
    
    metrics.push(HealthMetricDetail {
        id: "conn_idle".to_string(),
        label: "Idle Connections (>5min)".to_string(),
        value: format!("{}", idle_conns),
        raw_value: idle_conns as f64,
        unit: None,
        status: super::scoring::get_status(idle_conns as f64, 20.0, 50.0, true),
        weight: 0.25,
        threshold_warning: 20.0,
        threshold_critical: 50.0,
        description: Some("Connections idle for more than 5 minutes".to_string()),
    });
    
    let active_queries: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_stat_activity WHERE state = 'active'"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count active queries: {}", e))?;
    
    let active = active_queries.0;
    
    metrics.push(HealthMetricDetail {
        id: "conn_active".to_string(),
        label: "Active Queries".to_string(),
        value: format!("{}", active),
        raw_value: active as f64,
        unit: None,
        status: super::scoring::get_status(active as f64, 20.0, 50.0, true),
        weight: 0.20,
        threshold_warning: 20.0,
        threshold_critical: 50.0,
        description: Some("Currently executing queries".to_string()),
    });
    
    let waiting_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_stat_activity WHERE wait_event_type IS NOT NULL AND state = 'active'"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count waiting: {}", e))?;
    
    let waiting = waiting_count.0;
    
    metrics.push(HealthMetricDetail {
        id: "conn_waiting".to_string(),
        label: "Waiting Queries".to_string(),
        value: format!("{}", waiting),
        raw_value: waiting as f64,
        unit: None,
        status: super::scoring::get_status(waiting as f64, 5.0, 15.0, true),
        weight: 0.15,
        threshold_warning: 5.0,
        threshold_critical: 15.0,
        description: Some("Queries waiting on locks or I/O".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_storage_metrics(pool: &Pool<Postgres>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let db_size: Option<(i64,)> = sqlx::query_as(
        "SELECT pg_database_size(current_database())::bigint"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch database size: {}", e))?;
    
    let size_bytes = db_size.map(|(s,)| s).unwrap_or(0);
    let size_gb = size_bytes as f64 / 1024.0 / 1024.0 / 1024.0;
    
    metrics.push(HealthMetricDetail {
        id: "stor_db_size".to_string(),
        label: "Database Size".to_string(),
        value: format!("{:.2} GB", size_gb),
        raw_value: size_gb,
        unit: Some("GB".to_string()),
        status: "healthy".to_string(),
        weight: 0.25,
        threshold_warning: 100.0,
        threshold_critical: 500.0,
        description: Some("Current database size".to_string()),
    });
    
    let table_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_stat_user_tables"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count tables: {}", e))?;
    
    let tables = table_count.0;
    
    metrics.push(HealthMetricDetail {
        id: "stor_tables".to_string(),
        label: "User Tables".to_string(),
        value: format!("{}", tables),
        raw_value: tables as f64,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.15,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Number of user tables".to_string()),
    });
    
    let bloat_estimate: Option<(f64,)> = sqlx::query_as(
        "SELECT COALESCE(
            (SELECT SUM(bloat_size)::float / NULLIF(SUM(real_size), 0) * 100
             FROM (
                 SELECT 
                     pg_relation_size(c.oid) as real_size,
                     pg_relation_size(c.oid) * 0.2 as bloat_size
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
             ) t
            ), 0.0)"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to estimate bloat: {}", e))?;
    
    let bloat_pct = bloat_estimate.map(|(b,)| b).unwrap_or(0.0);
    
    metrics.push(HealthMetricDetail {
        id: "stor_bloat".to_string(),
        label: "Estimated Bloat".to_string(),
        value: format!("{:.1}%", bloat_pct),
        raw_value: bloat_pct,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(bloat_pct, 15.0, 30.0, true),
        weight: 0.30,
        threshold_warning: 15.0,
        threshold_critical: 30.0,
        description: Some("Estimated table/index bloat percentage".to_string()),
    });
    
    let large_tables: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_stat_user_tables 
        WHERE pg_relation_size(relid) > 1073741824"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count large tables: {}", e))?;
    
    let large = large_tables.0;
    
    metrics.push(HealthMetricDetail {
        id: "stor_large_tables".to_string(),
        label: "Large Tables (>1GB)".to_string(),
        value: format!("{}", large),
        raw_value: large as f64,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.30,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Tables larger than 1GB".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_maintenance_metrics(pool: &Pool<Postgres>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let autovacuum: Option<(String,)> = sqlx::query_as(
        "SELECT setting FROM pg_settings WHERE name = 'autovacuum'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to check autovacuum: {}", e))?;
    
    let av_enabled = autovacuum
        .map(|(s,)| s == "on")
        .unwrap_or(false);
    
    metrics.push(HealthMetricDetail {
        id: "maint_autovacuum".to_string(),
        label: "Autovacuum Status".to_string(),
        value: if av_enabled { "Enabled" } else { "Disabled" }.to_string(),
        raw_value: if av_enabled { 100.0 } else { 0.0 },
        unit: None,
        status: if av_enabled { "healthy" } else { "warning" }.to_string(),
        weight: 0.25,
        threshold_warning: 50.0,
        threshold_critical: 0.0,
        description: Some("Autovacuum daemon status".to_string()),
    });
    
    let stale_vacuum: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_stat_user_tables 
        WHERE last_vacuum IS NULL OR last_vacuum < NOW() - INTERVAL '7 days'"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to check vacuum status: {}", e))?;
    
    let stale = stale_vacuum.0;
    
    metrics.push(HealthMetricDetail {
        id: "maint_stale_vacuum".to_string(),
        label: "Tables Not Vacuumed (7d)".to_string(),
        value: format!("{}", stale),
        raw_value: stale as f64,
        unit: None,
        status: super::scoring::get_status(stale as f64, 50.0, 200.0, true),
        weight: 0.25,
        threshold_warning: 50.0,
        threshold_critical: 200.0,
        description: Some("Tables not vacuumed in 7+ days".to_string()),
    });
    
    let no_pk_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_stat_user_tables t
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_constraint c 
            WHERE c.conrelid = t.relid AND c.contype = 'p'
        )"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to check primary keys: {}", e))?;
    
    let no_pk = no_pk_count.0;
    
    metrics.push(HealthMetricDetail {
        id: "maint_no_pk".to_string(),
        label: "Tables Without PK".to_string(),
        value: format!("{}", no_pk),
        raw_value: no_pk as f64,
        unit: None,
        status: super::scoring::get_status(no_pk as f64, 0.0, 10.0, true),
        weight: 0.25,
        threshold_warning: 0.0,
        threshold_critical: 10.0,
        description: Some("Tables lacking a primary key".to_string()),
    });
    
    let unused_idx: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_stat_user_indexes 
        WHERE idx_scan = 0 AND idx_tup_read = 0"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to check unused indexes: {}", e))?;
    
    let unused = unused_idx.0;
    
    metrics.push(HealthMetricDetail {
        id: "maint_unused_idx".to_string(),
        label: "Unused Indexes".to_string(),
        value: format!("{}", unused),
        raw_value: unused as f64,
        unit: None,
        status: super::scoring::get_status(unused as f64, 10.0, 30.0, true),
        weight: 0.25,
        threshold_warning: 10.0,
        threshold_critical: 30.0,
        description: Some("Indexes never scanned".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_security_metrics(pool: &Pool<Postgres>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let super_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_roles WHERE rolsuper = true"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count superusers: {}", e))?;
    
    let supers = super_count.0;
    
    metrics.push(HealthMetricDetail {
        id: "sec_superusers".to_string(),
        label: "Superuser Count".to_string(),
        value: format!("{}", supers),
        raw_value: supers as f64,
        unit: None,
        status: super::scoring::get_status(supers as f64, 3.0, 10.0, true),
        weight: 0.30,
        threshold_warning: 3.0,
        threshold_critical: 10.0,
        description: Some("Number of superuser roles".to_string()),
    });
    
    let ssl_status: Option<(String,)> = sqlx::query_as(
        "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to check SSL: {}", e))?;
    
    let ssl_on = ssl_status.map(|(s,)| s == "on").unwrap_or(false);
    
    metrics.push(HealthMetricDetail {
        id: "sec_ssl".to_string(),
        label: "SSL Connection".to_string(),
        value: if ssl_on { "Enabled" } else { "Disabled" }.to_string(),
        raw_value: if ssl_on { 100.0 } else { 0.0 },
        unit: None,
        status: if ssl_on { "healthy" } else { "warning" }.to_string(),
        weight: 0.25,
        threshold_warning: 50.0,
        threshold_critical: 0.0,
        description: Some("Current connection SSL status".to_string()),
    });
    
    let public_usage: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM information_schema.table_privileges 
        WHERE grantee = 'PUBLIC' AND table_schema NOT IN ('pg_catalog', 'information_schema')"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to check public grants: {}", e))?;
    
    let public_grants = public_usage.0;
    
    metrics.push(HealthMetricDetail {
        id: "sec_public".to_string(),
        label: "Public Schema Grants".to_string(),
        value: format!("{}", public_grants),
        raw_value: public_grants as f64,
        unit: None,
        status: super::scoring::get_status(public_grants as f64, 10.0, 50.0, true),
        weight: 0.20,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Tables with PUBLIC access grants".to_string()),
    });
    
    let role_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM pg_roles"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count roles: {}", e))?;
    
    let roles = role_count.0;
    
    metrics.push(HealthMetricDetail {
        id: "sec_roles".to_string(),
        label: "Total Roles".to_string(),
        value: format!("{}", roles),
        raw_value: roles as f64,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.25,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Number of database roles".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}
