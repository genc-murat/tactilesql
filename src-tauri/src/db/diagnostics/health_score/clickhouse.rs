use crate::db_types::{ConnectionConfig, HealthCategory, HealthMetricDetail};
use crate::clickhouse::execute_query_generic;

pub struct ClickhouseHealthConfig {
    pub perf_weight: f32,
    pub conn_weight: f32,
    pub stor_weight: f32,
    pub maint_weight: f32,
    pub sec_weight: f32,
    pub query_cost_weight: f32,
}

impl Default for ClickhouseHealthConfig {
    fn default() -> Self {
        Self {
            perf_weight: 0.30,
            conn_weight: 0.10,
            stor_weight: 0.25,
            maint_weight: 0.15,
            sec_weight: 0.10,
            query_cost_weight: 0.10,
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
    let query_cost = collect_query_cost_metrics(config).await?;
    
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
        HealthCategory {
            id: "query_cost".to_string(),
            name: "Query Cost".to_string(),
            score: super::scoring::calculate_category_score(&query_cost.metrics),
            status: get_category_status(&query_cost.metrics),
            weight: health_config.query_cost_weight,
            metrics: query_cost.metrics,
            icon: "analytics".to_string(),
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
        weight: 0.15,
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
        weight: 0.15,
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
        weight: 0.10,
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
        weight: 0.10,
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
        weight: 0.10,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Queries taking >10s in last hour".to_string()),
    });

    let index_efficiency = query_single_float(config,
        "SELECT if(read > 0, selected / read * 100, 100) FROM (
            SELECT sum(ProfileEvents['SelectedRows']) as selected,
                   sum(ProfileEvents['ReadRows']) as read
            FROM system.query_log WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 1 HOUR
        )"
    ).await.unwrap_or(100.0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_index_efficiency".to_string(),
        label: "Index Efficiency".to_string(),
        value: format!("{:.1}%", index_efficiency),
        raw_value: index_efficiency,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(index_efficiency, 80.0, 50.0, false),
        weight: 0.13,
        threshold_warning: 80.0,
        threshold_critical: 50.0,
        description: Some("Selected rows vs read rows ratio (higher is better)".to_string()),
    });

    let network_io = query_single_float(config,
        "SELECT sum(read_bytes + written_bytes) / 1024 / 1024 / 1024 FROM system.query_log 
         WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 1 HOUR"
    ).await.unwrap_or(0.0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_network_io".to_string(),
        label: "Network I/O (1h)".to_string(),
        value: format!("{:.2} GB", network_io),
        raw_value: network_io,
        unit: Some("GB".to_string()),
        status: super::scoring::get_status(network_io, 10.0, 50.0, true),
        weight: 0.09,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Total network I/O in last hour".to_string()),
    });

    let bg_tasks = query_single_int(config,
        "SELECT value FROM system.metrics WHERE metric = 'BackgroundPoolTasks' LIMIT 1"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_bg_tasks".to_string(),
        label: "Background Pool Tasks".to_string(),
        value: format!("{}", bg_tasks),
        raw_value: bg_tasks as f64,
        unit: None,
        status: super::scoring::get_status(bg_tasks as f64, 50.0, 100.0, true),
        weight: 0.08,
        threshold_warning: 50.0,
        threshold_critical: 100.0,
        description: Some("Active background pool tasks".to_string()),
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
        weight: 0.15,
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
        weight: 0.12,
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
        weight: 0.12,
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
        weight: 0.12,
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
        weight: 0.10,
        threshold_warning: 10.0,
        threshold_critical: 100.0,
        description: Some("Pending replication tasks (if replicated)".to_string()),
    });

    let orphan_parts = query_single_int(config,
        "SELECT count() FROM system.part_log 
         WHERE event_type = 'RemovePart' 
         AND reason = 'Abandoned' 
         AND event_time > now() - INTERVAL 24 HOUR"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "stor_orphan_parts".to_string(),
        label: "Orphaned Parts (24h)".to_string(),
        value: format!("{}", orphan_parts),
        raw_value: orphan_parts as f64,
        unit: None,
        status: super::scoring::get_status(orphan_parts as f64, 10.0, 50.0, true),
        weight: 0.10,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Abandoned parts in last 24 hours".to_string()),
    });

    let no_projection = query_single_int(config,
        "SELECT count() FROM system.tables 
         WHERE engine LIKE '%MergeTree%' 
         AND database NOT IN ('system', 'information_schema')
         AND total_rows > 1000000
         AND NOT EXISTS (
             SELECT 1 FROM system.projections 
             WHERE database = system.tables.database 
             AND table = system.tables.name
         )"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "stor_no_projection".to_string(),
        label: "Large Tables w/o Projections".to_string(),
        value: format!("{}", no_projection),
        raw_value: no_projection as f64,
        unit: None,
        status: super::scoring::get_status(no_projection as f64, 20.0, 50.0, true),
        weight: 0.09,
        threshold_warning: 20.0,
        threshold_critical: 50.0,
        description: Some("Large tables (>1M rows) without projections".to_string()),
    });

    let disk_space_info = query_single_float(config,
        "SELECT sum(bytes_on_disk) / 1024 / 1024 / 1024 FROM system.parts 
         WHERE active = 1 AND disk_name = 'default'"
    ).await.unwrap_or(0.0);
    
    metrics.push(HealthMetricDetail {
        id: "stor_disk_usage".to_string(),
        label: "Default Disk Usage".to_string(),
        value: format!("{:.2} GB", disk_space_info),
        raw_value: disk_space_info,
        unit: Some("GB".to_string()),
        status: "healthy".to_string(),
        weight: 0.10,
        threshold_warning: 1000.0,
        threshold_critical: 5000.0,
        description: Some("Data size on default disk".to_string()),
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
        weight: 0.15,
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
        weight: 0.15,
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
        weight: 0.08,
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
        weight: 0.12,
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
        weight: 0.10,
        threshold_warning: 20.0,
        threshold_critical: 100.0,
        description: Some("MergeTree tables without TTL policy".to_string()),
    });

    let stale_parts = query_single_int(config,
        "SELECT count() FROM system.parts 
         WHERE active = 1 
         AND modification_time < now() - INTERVAL 7 DAY"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "maint_stale_parts".to_string(),
        label: "Stale Parts (>7d)".to_string(),
        value: format!("{}", stale_parts),
        raw_value: stale_parts as f64,
        unit: None,
        status: super::scoring::get_status(stale_parts as f64, 100.0, 500.0, true),
        weight: 0.10,
        threshold_warning: 100.0,
        threshold_critical: 500.0,
        description: Some("Parts older than 7 days (not merging)".to_string()),
    });

    let failed_merges = query_single_int(config,
        "SELECT count() FROM system.part_log 
         WHERE event_type = 'MergeFailed' 
         AND event_time > now() - INTERVAL 24 HOUR"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "maint_failed_merges".to_string(),
        label: "Failed Merges (24h)".to_string(),
        value: format!("{}", failed_merges),
        raw_value: failed_merges as f64,
        unit: None,
        status: super::scoring::get_status(failed_merges as f64, 5.0, 20.0, true),
        weight: 0.10,
        threshold_warning: 5.0,
        threshold_critical: 20.0,
        description: Some("Failed merge operations in last 24 hours".to_string()),
    });

    let ttl_pending = query_single_int(config,
        "SELECT count() FROM system.parts 
         WHERE active = 1 
         AND ttl_info.rows > 0"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "maint_ttl_pending".to_string(),
        label: "TTL Cleanup Pending".to_string(),
        value: format!("{}", ttl_pending),
        raw_value: ttl_pending as f64,
        unit: None,
        status: super::scoring::get_status(ttl_pending as f64, 1000.0, 5000.0, true),
        weight: 0.10,
        threshold_warning: 1000.0,
        threshold_critical: 5000.0,
        description: Some("Parts with expired TTL waiting cleanup".to_string()),
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
        weight: 0.15,
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
        weight: 0.15,
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
        weight: 0.10,
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
        weight: 0.08,
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
        weight: 0.07,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Number of row-level security policies".to_string()),
    });

    let passwordless = query_single_int(config,
        "SELECT count() FROM system.users WHERE authentication_type = 'no_password'"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "sec_passwordless".to_string(),
        label: "Passwordless Users".to_string(),
        value: format!("{}", passwordless),
        raw_value: passwordless as f64,
        unit: None,
        status: if passwordless > 0 { "critical" } else { "healthy" }.to_string(),
        weight: 0.15,
        threshold_warning: 0.0,
        threshold_critical: 0.0,
        description: Some("Users without password authentication".to_string()),
    });

    let excessive_grants = query_single_int(config,
        "SELECT count() FROM system.grants WHERE access_type = 'ALL'"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "sec_excessive_grants".to_string(),
        label: "Excessive Grants".to_string(),
        value: format!("{}", excessive_grants),
        raw_value: excessive_grants as f64,
        unit: None,
        status: super::scoring::get_status(excessive_grants as f64, 5.0, 10.0, true),
        weight: 0.15,
        threshold_warning: 5.0,
        threshold_critical: 10.0,
        description: Some("Number of 'ALL' privilege grants".to_string()),
    });

    let unique_ips = query_single_int(config,
        "SELECT count(DISTINCT initial_address) FROM system.processes"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "sec_unique_ips".to_string(),
        label: "Unique Client IPs".to_string(),
        value: format!("{}", unique_ips),
        raw_value: unique_ips as f64,
        unit: None,
        status: super::scoring::get_status(unique_ips as f64, 100.0, 500.0, true),
        weight: 0.10,
        threshold_warning: 100.0,
        threshold_critical: 500.0,
        description: Some("Distinct client IP addresses connected".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_query_cost_metrics(config: &ConnectionConfig) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let high_cpu_queries = query_single_int(config,
        "SELECT count() FROM system.query_log 
         WHERE type = 'QueryFinish' 
         AND event_time > now() - INTERVAL 1 HOUR
         AND ProfileEvents['RealTimeMicroseconds'] > 5000000"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "qcost_high_cpu".to_string(),
        label: "High CPU Queries (>5s)".to_string(),
        value: format!("{}", high_cpu_queries),
        raw_value: high_cpu_queries as f64,
        unit: None,
        status: super::scoring::get_status(high_cpu_queries as f64, 10.0, 50.0, true),
        weight: 0.20,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Queries with >5s CPU time in last hour".to_string()),
    });

    let high_mem_queries = query_single_int(config,
        "SELECT count() FROM system.query_log 
         WHERE type = 'QueryFinish' 
         AND event_time > now() - INTERVAL 1 HOUR
         AND memory_usage > 1073741824"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "qcost_high_mem".to_string(),
        label: "High Memory Queries (>1GB)".to_string(),
        value: format!("{}", high_mem_queries),
        raw_value: high_mem_queries as f64,
        unit: None,
        status: super::scoring::get_status(high_mem_queries as f64, 5.0, 20.0, true),
        weight: 0.18,
        threshold_warning: 5.0,
        threshold_critical: 20.0,
        description: Some("Queries consuming >1GB memory in last hour".to_string()),
    });

    let high_io_queries = query_single_int(config,
        "SELECT count() FROM system.query_log 
         WHERE type = 'QueryFinish' 
         AND event_time > now() - INTERVAL 1 HOUR
         AND read_bytes > 10737418240"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "qcost_high_io".to_string(),
        label: "High I/O Queries (>10GB)".to_string(),
        value: format!("{}", high_io_queries),
        raw_value: high_io_queries as f64,
        unit: None,
        status: super::scoring::get_status(high_io_queries as f64, 5.0, 20.0, true),
        weight: 0.18,
        threshold_warning: 5.0,
        threshold_critical: 20.0,
        description: Some("Queries reading >10GB data in last hour".to_string()),
    });

    let full_scan_queries = query_single_int(config,
        "SELECT count() FROM system.query_log 
         WHERE type = 'QueryFinish' 
         AND event_time > now() - INTERVAL 1 HOUR
         AND read_rows > 1000000
         AND selected_rows = read_rows"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "qcost_full_scan".to_string(),
        label: "Full Table Scans".to_string(),
        value: format!("{}", full_scan_queries),
        raw_value: full_scan_queries as f64,
        unit: None,
        status: super::scoring::get_status(full_scan_queries as f64, 10.0, 50.0, true),
        weight: 0.15,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Queries scanning >1M rows without filtering".to_string()),
    });

    let query_error_rate = query_single_float(config,
        "SELECT if(total > 0, errors / total * 100, 0) FROM (
            SELECT countIf(type = 'ExceptionWhileProcessing') as errors,
                   count() as total
            FROM system.query_log WHERE event_time > now() - INTERVAL 1 HOUR
        )"
    ).await.unwrap_or(0.0);
    
    metrics.push(HealthMetricDetail {
        id: "qcost_error_rate".to_string(),
        label: "Query Error Rate".to_string(),
        value: format!("{:.2}%", query_error_rate),
        raw_value: query_error_rate,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(query_error_rate, 5.0, 15.0, true),
        weight: 0.15,
        threshold_warning: 5.0,
        threshold_critical: 15.0,
        description: Some("Percentage of failed queries in last hour".to_string()),
    });

    let avg_rows_per_query = query_single_float(config,
        "SELECT avg(read_rows) FROM system.query_log 
         WHERE type = 'QueryFinish' 
         AND event_time > now() - INTERVAL 1 HOUR"
    ).await.unwrap_or(0.0);
    
    let avg_rows_k = avg_rows_per_query / 1000.0;
    
    metrics.push(HealthMetricDetail {
        id: "qcost_avg_rows".to_string(),
        label: "Avg Rows Read/Query".to_string(),
        value: format!("{:.1}K", avg_rows_k),
        raw_value: avg_rows_k,
        unit: Some("K rows".to_string()),
        status: super::scoring::get_status(avg_rows_k, 100.0, 1000.0, true),
        weight: 0.07,
        threshold_warning: 100.0,
        threshold_critical: 1000.0,
        description: Some("Average rows read per query in last hour".to_string()),
    });

    let subqueries_count = query_single_int(config,
        "SELECT count() FROM system.query_log 
         WHERE type = 'QueryFinish' 
         AND event_time > now() - INTERVAL 1 HOUR
         AND has_subqueries = 1"
    ).await.unwrap_or(0);
    
    metrics.push(HealthMetricDetail {
        id: "qcost_subqueries".to_string(),
        label: "Queries with Subqueries".to_string(),
        value: format!("{}", subqueries_count),
        raw_value: subqueries_count as f64,
        unit: None,
        status: super::scoring::get_status(subqueries_count as f64, 20.0, 100.0, true),
        weight: 0.07,
        threshold_warning: 20.0,
        threshold_critical: 100.0,
        description: Some("Queries containing subqueries in last hour".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}
