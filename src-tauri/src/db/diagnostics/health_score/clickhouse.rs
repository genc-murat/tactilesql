use crate::db_types::{ConnectionConfig, HealthCategory, HealthMetricDetail};
use crate::clickhouse::execute_query_generic;

pub struct ClickhouseHealthConfig {
    pub perf_weight: f32,
    pub conn_weight: f32,
    pub stor_weight: f32,
    pub maint_weight: f32,
    pub sec_weight: f32,
}

impl Default for ClickhouseHealthConfig {
    fn default() -> Self {
        Self {
            perf_weight: 0.35,
            conn_weight: 0.10,
            stor_weight: 0.30,
            maint_weight: 0.15,
            sec_weight: 0.10,
        }
    }
}

pub async fn collect_clickhouse_health_metrics(
    config: &ConnectionConfig,
    health_config: &ClickhouseHealthConfig,
) -> Result<Vec<HealthCategory>, String> {
    let performance = collect_performance_metrics(config).await?;
    let connections = collect_connection_metrics(config).await?;
    let storage = collect_storage_metrics(config).await?;
    let maintenance = collect_maintenance_metrics(config).await?;
    let security = collect_security_metrics(config).await?;
    
    Ok(vec![
        HealthCategory {
            id: "performance".to_string(),
            name: "Performance".to_string(),
            score: super::scoring::calculate_category_score(&performance.metrics),
            status: get_category_status(&performance.metrics),
            weight: health_config.perf_weight,
            metrics: performance.metrics,
            icon: "speed".to_string(),
        },
        HealthCategory {
            id: "connections".to_string(),
            name: "Connections".to_string(),
            score: super::scoring::calculate_category_score(&connections.metrics),
            status: get_category_status(&connections.metrics),
            weight: health_config.conn_weight,
            metrics: connections.metrics,
            icon: "link".to_string(),
        },
        HealthCategory {
            id: "storage".to_string(),
            name: "Storage".to_string(),
            score: super::scoring::calculate_category_score(&storage.metrics),
            status: get_category_status(&storage.metrics),
            weight: health_config.stor_weight,
            metrics: storage.metrics,
            icon: "storage".to_string(),
        },
        HealthCategory {
            id: "maintenance".to_string(),
            name: "Maintenance".to_string(),
            score: super::scoring::calculate_category_score(&maintenance.metrics),
            status: get_category_status(&maintenance.metrics),
            weight: health_config.maint_weight,
            metrics: maintenance.metrics,
            icon: "build".to_string(),
        },
        HealthCategory {
            id: "security".to_string(),
            name: "Security".to_string(),
            score: super::scoring::calculate_category_score(&security.metrics),
            status: get_category_status(&security.metrics),
            weight: health_config.sec_weight,
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

async fn query_single_float(config: &ConnectionConfig, query: &str) -> Result<f64, String> {
    let results = execute_query_generic(config, query.to_string()).await?;
    
    if let Some(result_set) = results.first() {
        if let Some(row) = result_set.rows.first() {
            if let Some(val) = row.first() {
                return match val {
                    serde_json::Value::Number(n) => Ok(n.as_f64().unwrap_or(0.0)),
                    serde_json::Value::String(s) => Ok(s.parse().unwrap_or(0.0)),
                    _ => Ok(0.0),
                };
            }
        }
    }
    Ok(0.0)
}

async fn query_single_int(config: &ConnectionConfig, query: &str) -> Result<i64, String> {
    Ok(query_single_float(config, query).await? as i64)
}

async fn collect_performance_metrics(config: &ConnectionConfig) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let mark_cache_hit = query_single_float(config, 
        "SELECT if(total > 0, hits / total * 100, 100) FROM (
            SELECT sum(ProfileEvents['MarkCacheHits']) as hits,
                   sum(ProfileEvents['MarkCacheMisses']) as misses,
                   hits + misses as total
            FROM system.query_log WHERE type = 'QueryFinish'
        )"
    ).await.unwrap_or(100.0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_mark_cache".to_string(),
        label: "Mark Cache Hit Ratio".to_string(),
        value: format!("{:.1}%", mark_cache_hit),
        raw_value: mark_cache_hit,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(mark_cache_hit, 95.0, 85.0, false),
        weight: 0.25,
        threshold_warning: 95.0,
        threshold_critical: 85.0,
        description: Some("Mark cache efficiency for MergeTree tables".to_string()),
    });
    
    let avg_query_duration = query_single_float(config,
        "SELECT avg(query_duration_ms) FROM system.query_log 
         WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 1 HOUR"
    ).await.unwrap_or(0.0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_query_duration".to_string(),
        label: "Avg Query Duration".to_string(),
        value: format!("{:.0} ms", avg_query_duration),
        raw_value: avg_query_duration,
        unit: Some("ms".to_string()),
        status: super::scoring::get_status(avg_query_duration, 500.0, 2000.0, true),
        weight: 0.25,
        threshold_warning: 500.0,
        threshold_critical: 2000.0,
        description: Some("Average query duration in last hour".to_string()),
    });
    
    let memory_usage = query_single_float(config,
        "SELECT value FROM system.asynchronous_metrics 
         WHERE metric = 'MemoryTracking' LIMIT 1"
    ).await.unwrap_or(0.0);
    
    let memory_gb = memory_usage / 1024.0 / 1024.0 / 1024.0;
    
    metrics.push(HealthMetricDetail {
        id: "perf_memory".to_string(),
        label: "Memory Usage".to_string(),
        value: format!("{:.2} GB", memory_gb),
        raw_value: memory_gb,
        unit: Some("GB".to_string()),
        status: "healthy".to_string(),
        weight: 0.20,
        threshold_warning: 16.0 * 1024.0 * 1024.0 * 1024.0,
        threshold_critical: 32.0 * 1024.0 * 1024.0 * 1024.0,
        description: Some("Current memory tracking value".to_string()),
    });
    
    let read_vs_selected = query_single_float(config,
        "SELECT if(selected > 0, read / selected * 100, 100) FROM (
            SELECT sum(read_rows) as read, sum(selected_rows) as selected
            FROM system.query_log WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 1 HOUR
        )"
    ).await.unwrap_or(100.0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_read_ratio".to_string(),
        label: "Read/Selected Ratio".to_string(),
        value: format!("{:.1}%", read_vs_selected),
        raw_value: read_vs_selected,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(read_vs_selected, 200.0, 500.0, true),
        weight: 0.15,
        threshold_warning: 200.0,
        threshold_critical: 500.0,
        description: Some("Ratio of rows read to rows selected (lower is better)".to_string()),
    });
    
    let slow_queries = query_single_int(config,
        "SELECT count() FROM system.query_log 
         WHERE type = 'QueryFinish' 
         AND query_duration_ms > 10000 
         AND event_time > now() - INTERVAL 1 HOUR"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_slow_queries".to_string(),
        label: "Slow Queries (>10s)".to_string(),
        value: format!("{}", slow_queries),
        raw_value: slow_queries as f64,
        unit: None,
        status: super::scoring::get_status(slow_queries as f64, 10.0, 50.0, true),
        weight: 0.15,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Queries taking >10s in last hour".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_connection_metrics(config: &ConnectionConfig) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let active_queries = query_single_int(config,
        "SELECT count() FROM system.processes"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "conn_active".to_string(),
        label: "Active Queries".to_string(),
        value: format!("{}", active_queries),
        raw_value: active_queries as f64,
        unit: None,
        status: super::scoring::get_status(active_queries as f64, 50.0, 100.0, true),
        weight: 0.35,
        threshold_warning: 50.0,
        threshold_critical: 100.0,
        description: Some("Currently running queries".to_string()),
    });
    
    let total_threads = query_single_int(config,
        "SELECT value FROM system.metrics WHERE metric = 'TotalThreads' LIMIT 1"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "conn_threads".to_string(),
        label: "Active Threads".to_string(),
        value: format!("{}", total_threads),
        raw_value: total_threads as f64,
        unit: None,
        status: super::scoring::get_status(total_threads as f64, 100.0, 500.0, true),
        weight: 0.25,
        threshold_warning: 100.0,
        threshold_critical: 500.0,
        description: Some("Total threads in thread pool".to_string()),
    });
    
    let queries_metric = query_single_int(config,
        "SELECT value FROM system.metrics WHERE metric = 'Query' LIMIT 1"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "conn_queued".to_string(),
        label: "Queued Queries".to_string(),
        value: format!("{}", queries_metric),
        raw_value: queries_metric as f64,
        unit: None,
        status: super::scoring::get_status(queries_metric as f64, 10.0, 50.0, true),
        weight: 0.20,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Queries being executed or waiting".to_string()),
    });
    
    let uptime = query_single_int(config,
        "SELECT value FROM system.asynchronous_metrics WHERE metric = 'Uptime' LIMIT 1"
    ).await.unwrap_or(0);
    
    let uptime_hours = uptime / 3600;
    
    metrics.push(HealthMetricDetail {
        id: "conn_uptime".to_string(),
        label: "Server Uptime".to_string(),
        value: format!("{}h", uptime_hours),
        raw_value: uptime as f64,
        unit: Some("hours".to_string()),
        status: "healthy".to_string(),
        weight: 0.20,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Server uptime in seconds".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_storage_metrics(config: &ConnectionConfig) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let total_parts = query_single_int(config,
        "SELECT count() FROM system.parts WHERE active = 1"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "stor_parts".to_string(),
        label: "Total Active Parts".to_string(),
        value: format!("{}", total_parts),
        raw_value: total_parts as f64,
        unit: None,
        status: super::scoring::get_status(total_parts as f64, 10000.0, 50000.0, true),
        weight: 0.25,
        threshold_warning: 10000.0,
        threshold_critical: 50000.0,
        description: Some("Total active parts across all tables".to_string()),
    });
    
    let max_parts_per_table = query_single_int(config,
        "SELECT max(cnt) FROM (
            SELECT count() as cnt FROM system.parts WHERE active = 1 GROUP BY database, table
        )"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "stor_max_parts".to_string(),
        label: "Max Parts Per Table".to_string(),
        value: format!("{}", max_parts_per_table),
        raw_value: max_parts_per_table as f64,
        unit: None,
        status: super::scoring::get_status(max_parts_per_table as f64, 1000.0, 3000.0, true),
        weight: 0.20,
        threshold_warning: 1000.0,
        threshold_critical: 3000.0,
        description: Some("Maximum parts count in single table".to_string()),
    });
    
    let compression_ratio = query_single_float(config,
        "SELECT if(compressed > 0, uncompressed / compressed, 1) FROM (
            SELECT sum(data_compressed_bytes) as compressed,
                   sum(data_uncompressed_bytes) as uncompressed
            FROM system.parts WHERE active = 1
        )"
    ).await.unwrap_or(1.0);
    
    metrics.push(HealthMetricDetail {
        id: "stor_compression".to_string(),
        label: "Compression Ratio".to_string(),
        value: format!("{:.1}x", compression_ratio),
        raw_value: compression_ratio,
        unit: Some("x".to_string()),
        status: super::scoring::get_status(compression_ratio, 3.0, 1.5, false),
        weight: 0.20,
        threshold_warning: 3.0,
        threshold_critical: 1.5,
        description: Some("Data compression ratio (higher is better)".to_string()),
    });
    
    let total_size = query_single_float(config,
        "SELECT sum(bytes_on_disk) FROM system.parts WHERE active = 1"
    ).await.unwrap_or(0.0);
    
    let size_gb = total_size / 1024.0 / 1024.0 / 1024.0;
    
    metrics.push(HealthMetricDetail {
        id: "stor_size".to_string(),
        label: "Total Data Size".to_string(),
        value: format!("{:.2} GB", size_gb),
        raw_value: size_gb,
        unit: Some("GB".to_string()),
        status: "healthy".to_string(),
        weight: 0.20,
        threshold_warning: 1000.0,
        threshold_critical: 5000.0,
        description: Some("Total compressed data size".to_string()),
    });
    
    let replication_queue = query_single_int(config,
        "SELECT count() FROM system.replication_queue"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "stor_replication".to_string(),
        label: "Replication Queue".to_string(),
        value: format!("{}", replication_queue),
        raw_value: replication_queue as f64,
        unit: None,
        status: super::scoring::get_status(replication_queue as f64, 10.0, 100.0, true),
        weight: 0.15,
        threshold_warning: 10.0,
        threshold_critical: 100.0,
        description: Some("Pending replication tasks (if replicated)".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_maintenance_metrics(config: &ConnectionConfig) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let active_merges = query_single_int(config,
        "SELECT count() FROM system.merges"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "maint_merges".to_string(),
        label: "Active Merges".to_string(),
        value: format!("{}", active_merges),
        raw_value: active_merges as f64,
        unit: None,
        status: super::scoring::get_status(active_merges as f64, 10.0, 50.0, true),
        weight: 0.25,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Currently running merge operations".to_string()),
    });
    
    let pending_mutations = query_single_int(config,
        "SELECT count() FROM system.mutations WHERE is_done = 0"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "maint_mutations".to_string(),
        label: "Pending Mutations".to_string(),
        value: format!("{}", pending_mutations),
        raw_value: pending_mutations as f64,
        unit: None,
        status: super::scoring::get_status(pending_mutations as f64, 5.0, 20.0, true),
        weight: 0.25,
        threshold_warning: 5.0,
        threshold_critical: 20.0,
        description: Some("Mutations not yet completed".to_string()),
    });
    
    let wide_parts = query_single_int(config,
        "SELECT count() FROM system.parts 
        WHERE active = 1 AND part_type = 'Wide'"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "maint_wide_parts".to_string(),
        label: "Wide Parts".to_string(),
        value: format!("{}", wide_parts),
        raw_value: wide_parts as f64,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.15,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Parts stored in wide format".to_string()),
    });
    
    let detached_parts = query_single_int(config,
        "SELECT count() FROM system.detached_parts"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "maint_detached".to_string(),
        label: "Detached Parts".to_string(),
        value: format!("{}", detached_parts),
        raw_value: detached_parts as f64,
        unit: None,
        status: super::scoring::get_status(detached_parts as f64, 10.0, 50.0, true),
        weight: 0.20,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Detached parts (may indicate issues)".to_string()),
    });
    
    let tables_no_ttl = query_single_int(config,
        "SELECT count() FROM system.tables 
        WHERE engine LIKE '%MergeTree%' 
        AND database NOT IN ('system', 'information_schema')
        AND NOT has_own_ttl"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "maint_no_ttl".to_string(),
        label: "Tables Without TTL".to_string(),
        value: format!("{}", tables_no_ttl),
        raw_value: tables_no_ttl as f64,
        unit: None,
        status: super::scoring::get_status(tables_no_ttl as f64, 20.0, 100.0, true),
        weight: 0.15,
        threshold_warning: 20.0,
        threshold_critical: 100.0,
        description: Some("MergeTree tables without TTL policy".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_security_metrics(config: &ConnectionConfig) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let user_count = query_single_int(config,
        "SELECT count() FROM system.users"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "sec_users".to_string(),
        label: "User Count".to_string(),
        value: format!("{}", user_count),
        raw_value: user_count as f64,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.25,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Number of configured users".to_string()),
    });
    
    let readonly = query_single_int(config,
        "SELECT if(toString(readonly) = '1', 1, 0) FROM (
            SELECT value as readonly FROM system.settings WHERE name = 'readonly' LIMIT 1
        )"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "sec_readonly".to_string(),
        label: "Readonly Mode".to_string(),
        value: if readonly == 1 { "Enabled" } else { "Disabled" }.to_string(),
        raw_value: readonly as f64,
        unit: None,
        status: if readonly == 1 { "warning" } else { "healthy" }.to_string(),
        weight: 0.25,
        threshold_warning: 0.0,
        threshold_critical: 0.0,
        description: Some("Server readonly mode status".to_string()),
    });
    
    let roles_count = query_single_int(config,
        "SELECT count() FROM system.roles"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "sec_roles".to_string(),
        label: "Role Count".to_string(),
        value: format!("{}", roles_count),
        raw_value: roles_count as f64,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.20,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Number of configured roles".to_string()),
    });
    
    let settings_profiles = query_single_int(config,
        "SELECT count() FROM system.settings_profiles"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "sec_profiles".to_string(),
        label: "Settings Profiles".to_string(),
        value: format!("{}", settings_profiles),
        raw_value: settings_profiles as f64,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.15,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Number of settings profiles".to_string()),
    });
    
    let row_policies = query_single_int(config,
        "SELECT count() FROM system.row_policies"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "sec_policies".to_string(),
        label: "Row Policies".to_string(),
        value: format!("{}", row_policies),
        raw_value: row_policies as f64,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.15,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Number of row-level security policies".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}
