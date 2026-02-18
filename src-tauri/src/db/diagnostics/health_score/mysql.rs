use crate::db_types::{HealthCategory, HealthMetricDetail};
use sqlx::{MySql, Pool};
use super::scoring::get_status;

pub struct MySqlHealthConfig {
    pub perf_weight: f32,
    pub conn_weight: f32,
    pub stor_weight: f32,
    pub maint_weight: f32,
    pub sec_weight: f32,
}

impl Default for MySqlHealthConfig {
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

pub async fn collect_mysql_health_metrics(
    pool: &Pool<MySql>,
    config: &MySqlHealthConfig,
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
            status: if performance.metrics.iter().any(|m| m.status == "critical") {
                "critical"
            } else if performance.metrics.iter().any(|m| m.status == "warning") {
                "warning"
            } else {
                "healthy"
            }.to_string(),
            weight: config.perf_weight,
            metrics: performance.metrics,
            icon: "speed".to_string(),
        },
        HealthCategory {
            id: "connections".to_string(),
            name: "Connections".to_string(),
            score: super::scoring::calculate_category_score(&connections.metrics),
            status: if connections.metrics.iter().any(|m| m.status == "critical") {
                "critical"
            } else if connections.metrics.iter().any(|m| m.status == "warning") {
                "warning"
            } else {
                "healthy"
            }.to_string(),
            weight: config.conn_weight,
            metrics: connections.metrics,
            icon: "link".to_string(),
        },
        HealthCategory {
            id: "storage".to_string(),
            name: "Storage".to_string(),
            score: super::scoring::calculate_category_score(&storage.metrics),
            status: if storage.metrics.iter().any(|m| m.status == "critical") {
                "critical"
            } else if storage.metrics.iter().any(|m| m.status == "warning") {
                "warning"
            } else {
                "healthy"
            }.to_string(),
            weight: config.stor_weight,
            metrics: storage.metrics,
            icon: "storage".to_string(),
        },
        HealthCategory {
            id: "maintenance".to_string(),
            name: "Maintenance".to_string(),
            score: super::scoring::calculate_category_score(&maintenance.metrics),
            status: if maintenance.metrics.iter().any(|m| m.status == "critical") {
                "critical"
            } else if maintenance.metrics.iter().any(|m| m.status == "warning") {
                "warning"
            } else {
                "healthy"
            }.to_string(),
            weight: config.maint_weight,
            metrics: maintenance.metrics,
            icon: "build".to_string(),
        },
        HealthCategory {
            id: "security".to_string(),
            name: "Security".to_string(),
            score: super::scoring::calculate_category_score(&security.metrics),
            status: if security.metrics.iter().any(|m| m.status == "critical") {
                "critical"
            } else if security.metrics.iter().any(|m| m.status == "warning") {
                "warning"
            } else {
                "healthy"
            }.to_string(),
            weight: config.sec_weight,
            metrics: security.metrics,
            icon: "lock".to_string(),
        },
    ])
}

struct CategoryResult {
    metrics: Vec<HealthMetricDetail>,
}

async fn collect_performance_metrics(pool: &Pool<MySql>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let status_vars: Vec<(String, String)> = sqlx::query_as(
        "SHOW GLOBAL STATUS WHERE Variable_name IN (
            'Innodb_buffer_pool_read_requests',
            'Innodb_buffer_pool_reads',
            'Slow_queries',
            'Uptime',
            'Handler_read_rnd_next',
            'Handler_read_first',
            'Handler_read_key',
            'Created_tmp_disk_tables',
            'Created_tmp_tables',
            'Qcache_hits',
            'Com_select'
        )"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch status variables: {}", e))?;
    
    let vars: std::collections::HashMap<String, f64> = status_vars
        .into_iter()
        .filter_map(|(k, v)| v.parse::<f64>().ok().map(|val| (k, val)))
        .collect();
    
    let buffer_read_requests = vars.get("Innodb_buffer_pool_read_requests").copied().unwrap_or(0.0);
    let buffer_reads = vars.get("Innodb_buffer_pool_reads").copied().unwrap_or(0.0);
    let buffer_hit_ratio = if buffer_read_requests + buffer_reads > 0.0 {
        (buffer_read_requests / (buffer_read_requests + buffer_reads)) * 100.0
    } else {
        100.0
    };
    
    metrics.push(HealthMetricDetail {
        id: "perf_buffer_hit".to_string(),
        label: "Buffer Pool Hit Ratio".to_string(),
        value: format!("{:.1}%", buffer_hit_ratio),
        raw_value: buffer_hit_ratio,
        unit: Some("%".to_string()),
        status: get_status(buffer_hit_ratio, 95.0, 85.0, false),
        weight: 0.35,
        threshold_warning: 95.0,
        threshold_critical: 85.0,
        description: Some("Percentage of data read from buffer pool vs disk".to_string()),
    });
    
    let slow_queries = vars.get("Slow_queries").copied().unwrap_or(0.0);
    let uptime = vars.get("Uptime").copied().unwrap_or(1.0);
    let slow_query_rate = if uptime > 0.0 { (slow_queries / uptime) * 60.0 } else { 0.0 };
    
    metrics.push(HealthMetricDetail {
        id: "perf_slow_queries".to_string(),
        label: "Slow Queries/min".to_string(),
        value: format!("{:.1}", slow_query_rate),
        raw_value: slow_query_rate,
        unit: Some("/min".to_string()),
        status: get_status(slow_query_rate, 10.0, 50.0, true),
        weight: 0.25,
        threshold_warning: 10.0,
        threshold_critical: 50.0,
        description: Some("Average slow queries per minute since server start".to_string()),
    });
    
    let handler_rnd_next = vars.get("Handler_read_rnd_next").copied().unwrap_or(0.0);
    let handler_first = vars.get("Handler_read_first").copied().unwrap_or(0.0);
    let handler_key = vars.get("Handler_read_key").copied().unwrap_or(0.0);
    let total_reads = handler_rnd_next + handler_first + handler_key;
    let full_scan_ratio = if total_reads > 0.0 {
        (handler_rnd_next / total_reads) * 100.0
    } else {
        0.0
    };
    
    metrics.push(HealthMetricDetail {
        id: "perf_full_scan".to_string(),
        label: "Full Table Scan Ratio".to_string(),
        value: format!("{:.1}%", full_scan_ratio),
        raw_value: full_scan_ratio,
        unit: Some("%".to_string()),
        status: get_status(full_scan_ratio, 10.0, 25.0, true),
        weight: 0.20,
        threshold_warning: 10.0,
        threshold_critical: 25.0,
        description: Some("Ratio of full table scans to indexed reads".to_string()),
    });
    
    let tmp_disk = vars.get("Created_tmp_disk_tables").copied().unwrap_or(0.0);
    let tmp_total = vars.get("Created_tmp_tables").copied().unwrap_or(1.0);
    let tmp_disk_ratio = if tmp_total > 0.0 { (tmp_disk / tmp_total) * 100.0 } else { 0.0 };
    
    metrics.push(HealthMetricDetail {
        id: "perf_tmp_tables".to_string(),
        label: "Temp Tables on Disk".to_string(),
        value: format!("{:.1}%", tmp_disk_ratio),
        raw_value: tmp_disk_ratio,
        unit: Some("%".to_string()),
        status: get_status(tmp_disk_ratio, 25.0, 50.0, true),
        weight: 0.10,
        threshold_warning: 25.0,
        threshold_critical: 50.0,
        description: Some("Ratio of temporary tables created on disk".to_string()),
    });
    
    let qcache_hits = vars.get("Qcache_hits").copied().unwrap_or(0.0);
    let com_select = vars.get("Com_select").copied().unwrap_or(0.0);
    let qcache_ratio = if qcache_hits + com_select > 0.0 {
        (qcache_hits / (qcache_hits + com_select)) * 100.0
    } else {
        0.0
    };
    
    metrics.push(HealthMetricDetail {
        id: "perf_query_cache".to_string(),
        label: "Query Cache Hit".to_string(),
        value: format!("{:.1}%", qcache_ratio),
        raw_value: qcache_ratio,
        unit: Some("%".to_string()),
        status: get_status(qcache_ratio, 80.0, 60.0, false),
        weight: 0.10,
        threshold_warning: 80.0,
        threshold_critical: 60.0,
        description: Some("Query cache hit ratio (deprecated in MySQL 8.0)".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_connection_metrics(pool: &Pool<MySql>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let status_vars: Vec<(String, String)> = sqlx::query_as(
        "SHOW GLOBAL STATUS WHERE Variable_name IN (
            'Threads_connected',
            'Max_used_connections',
            'Connections',
            'Connection_errors_total'
        )"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch connection status: {}", e))?;
    
    let vars: std::collections::HashMap<String, f64> = status_vars
        .into_iter()
        .filter_map(|(k, v)| v.parse::<f64>().ok().map(|val| (k, val)))
        .collect();
    
    let max_conn_row: Option<(i64,)> = sqlx::query_as(
        "SELECT CAST(VARIABLE_VALUE AS SIGNED) FROM performance_schema.global_variables WHERE VARIABLE_NAME = 'max_connections'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch max_connections: {}", e))?;
    
    let max_connections = max_conn_row.map(|r| r.0 as f64).unwrap_or(151.0);
    let threads_connected = vars.get("Threads_connected").copied().unwrap_or(0.0);
    let conn_usage = (threads_connected / max_connections) * 100.0;
    
    metrics.push(HealthMetricDetail {
        id: "conn_usage".to_string(),
        label: "Connection Usage".to_string(),
        value: format!("{}/{}", threads_connected as i32, max_connections as i32),
        raw_value: conn_usage,
        unit: Some("%".to_string()),
        status: get_status(conn_usage, 70.0, 90.0, true),
        weight: 0.40,
        threshold_warning: 70.0,
        threshold_critical: 90.0,
        description: Some(format!("Using {:.1}% of max connections", conn_usage)),
    });
    
    let max_used = vars.get("Max_used_connections").copied().unwrap_or(0.0);
    let max_used_ratio = (max_used / max_connections) * 100.0;
    
    metrics.push(HealthMetricDetail {
        id: "conn_max_used".to_string(),
        label: "Peak Connection Usage".to_string(),
        value: format!("{}/{}", max_used as i32, max_connections as i32),
        raw_value: max_used_ratio,
        unit: Some("%".to_string()),
        status: get_status(max_used_ratio, 80.0, 95.0, true),
        weight: 0.15,
        threshold_warning: 80.0,
        threshold_critical: 95.0,
        description: Some("Highest connection count since server start".to_string()),
    });
    
    let total_connections = vars.get("Connections").copied().unwrap_or(1.0);
    let connection_errors = vars.get("Connection_errors_total").copied().unwrap_or(0.0);
    let error_ratio = if total_connections > 0.0 {
        (connection_errors / total_connections) * 100.0
    } else {
        0.0
    };
    
    metrics.push(HealthMetricDetail {
        id: "conn_errors".to_string(),
        label: "Connection Error Rate".to_string(),
        value: format!("{:.2}%", error_ratio),
        raw_value: error_ratio,
        unit: Some("%".to_string()),
        status: get_status(error_ratio, 1.0, 5.0, true),
        weight: 0.25,
        threshold_warning: 1.0,
        threshold_critical: 5.0,
        description: Some("Percentage of connection attempts that failed".to_string()),
    });
    
    let idle_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE Command = 'Sleep' AND Time > 60"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count idle connections: {}", e))?;
    
    let idle_conns = idle_count.0 as f64;
    
    metrics.push(HealthMetricDetail {
        id: "conn_idle".to_string(),
        label: "Idle Connections (>1min)".to_string(),
        value: format!("{}", idle_conns as i32),
        raw_value: idle_conns,
        unit: None,
        status: get_status(idle_conns, 30.0, 100.0, true),
        weight: 0.20,
        threshold_warning: 30.0,
        threshold_critical: 100.0,
        description: Some("Connections idle for more than 1 minute".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_storage_metrics(pool: &Pool<MySql>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let db_sizes: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        "SELECT 
            table_schema,
            SUM(data_length) as data_size,
            SUM(index_length) as index_size,
            SUM(data_free) as free_size
        FROM information_schema.TABLES
        WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        GROUP BY table_schema"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch database sizes: {}", e))?;
    
    let total_data: i64 = db_sizes.iter().map(|(_, d, _, _)| d).sum();
    let total_index: i64 = db_sizes.iter().map(|(_, _, i, _)| i).sum();
    let total_free: i64 = db_sizes.iter().map(|(_, _, _, f)| f).sum();
    let total_size = total_data + total_index;
    
    let bloat_ratio = if total_size > 0 {
        (total_free as f64 / total_size as f64) * 100.0
    } else {
        0.0
    };
    
    metrics.push(HealthMetricDetail {
        id: "stor_bloat".to_string(),
        label: "Data Bloat Ratio".to_string(),
        value: format!("{:.1}%", bloat_ratio),
        raw_value: bloat_ratio,
        unit: Some("%".to_string()),
        status: get_status(bloat_ratio, 15.0, 30.0, true),
        weight: 0.25,
        threshold_warning: 15.0,
        threshold_critical: 30.0,
        description: Some(format!("~{} GB of fragmented space", total_free / 1024 / 1024 / 1024)),
    });
    
    let fragmented_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM information_schema.TABLES 
        WHERE data_free > 0 
        AND data_length > 10485760
        AND (data_free / (data_length + index_length)) > 0.25"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count fragmented tables: {}", e))?;
    
    let fragmented = fragmented_count.0 as f64;
    
    metrics.push(HealthMetricDetail {
        id: "stor_fragmented".to_string(),
        label: "Fragmented Tables".to_string(),
        value: format!("{}", fragmented as i32),
        raw_value: fragmented,
        unit: None,
        status: get_status(fragmented, 10.0, 25.0, true),
        weight: 0.20,
        threshold_warning: 10.0,
        threshold_critical: 25.0,
        description: Some("Tables with >25% fragmentation and >10MB size".to_string()),
    });
    
    let total_db_size = (total_data + total_index) as f64;
    let size_display = format_bytes(total_db_size);
    
    metrics.push(HealthMetricDetail {
        id: "stor_disk_usage".to_string(),
        label: "Total Database Size".to_string(),
        value: size_display,
        raw_value: total_db_size,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.35,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some(format!("{} databases, {} tables", db_sizes.len(), db_sizes.len())),
    });
    
    let table_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM information_schema.TABLES 
        WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to count tables: {}", e))?;
    
    let tables = table_count.0 as f64;
    
    metrics.push(HealthMetricDetail {
        id: "stor_tables".to_string(),
        label: "Total Tables".to_string(),
        value: format!("{}", tables as i32),
        raw_value: tables,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.20,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Number of user tables across all databases".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_maintenance_metrics(pool: &Pool<MySql>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let unused_idx_result: Result<Vec<(String, String, String)>, _> = sqlx::query_as(
        "SELECT object_schema, object_name, index_name 
        FROM performance_schema.table_io_waits_summary_by_index_usage 
        WHERE index_name IS NOT NULL 
        AND index_name != 'PRIMARY' 
        AND count_star = 0 
        AND object_schema NOT IN ('mysql', 'performance_schema', 'information_schema')
        LIMIT 100"
    )
    .fetch_all(pool)
    .await;
    
    let unused_count = match unused_idx_result {
        Ok(rows) => rows.len() as f64,
        Err(_) => 0.0,
    };
    
    metrics.push(HealthMetricDetail {
        id: "maint_unused_idx".to_string(),
        label: "Unused Indexes".to_string(),
        value: format!("{}", unused_count as i32),
        raw_value: unused_count,
        unit: None,
        status: get_status(unused_count, 5.0, 20.0, true),
        weight: 0.25,
        threshold_warning: 5.0,
        threshold_critical: 20.0,
        description: Some("Indexes not used since server start".to_string()),
    });
    
    let no_pk_result: Result<(i64,), _> = sqlx::query_as(
        "SELECT COUNT(*) FROM information_schema.TABLES t
        WHERE t.table_schema NOT IN ('mysql', 'performance_schema', 'information_schema', 'sys')
        AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (
            SELECT 1 FROM information_schema.COLUMNS c 
            WHERE c.table_schema = t.table_schema 
            AND c.table_name = t.table_name 
            AND c.column_key = 'PRI'
        )"
    )
    .fetch_one(pool)
    .await;
    
    let no_pk_count = match no_pk_result {
        Ok((count,)) => count as f64,
        Err(_) => 0.0,
    };
    
    metrics.push(HealthMetricDetail {
        id: "maint_tables_no_pk".to_string(),
        label: "Tables without PK".to_string(),
        value: format!("{}", no_pk_count as i32),
        raw_value: no_pk_count,
        unit: None,
        status: get_status(no_pk_count, 0.0, 5.0, true),
        weight: 0.25,
        threshold_warning: 0.0,
        threshold_critical: 5.0,
        description: Some("Tables lacking a primary key".to_string()),
    });
    
    let dupe_idx_result: Result<(i64,), _> = sqlx::query_as(
        "SELECT COUNT(*) FROM sys.schema_redundant_indexes"
    )
    .fetch_one(pool)
    .await;
    
    let dupe_count = match dupe_idx_result {
        Ok((count,)) => count as f64,
        Err(_) => 0.0,
    };
    
    metrics.push(HealthMetricDetail {
        id: "maint_dupe_idx".to_string(),
        label: "Duplicate Indexes".to_string(),
        value: format!("{}", dupe_count as i32),
        raw_value: dupe_count,
        unit: None,
        status: get_status(dupe_count, 3.0, 10.0, true),
        weight: 0.20,
        threshold_warning: 3.0,
        threshold_critical: 10.0,
        description: Some("Redundant indexes that can be removed".to_string()),
    });
    
    let stats_check: Result<(i64,), _> = sqlx::query_as(
        "SELECT COUNT(*) FROM information_schema.STATISTICS 
        WHERE table_schema NOT IN ('mysql', 'performance_schema', 'information_schema', 'sys')"
    )
    .fetch_one(pool)
    .await;
    
    let stats_ok = stats_check.map(|_| 100.0).unwrap_or(0.0);
    
    metrics.push(HealthMetricDetail {
        id: "maint_stats".to_string(),
        label: "Statistics Status".to_string(),
        value: "Available".to_string(),
        raw_value: stats_ok,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.30,
        threshold_warning: 50.0,
        threshold_critical: 20.0,
        description: Some("Index statistics availability".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_security_metrics(pool: &Pool<MySql>) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let empty_pass_result: Result<(i64,), _> = sqlx::query_as(
        "SELECT COUNT(*) FROM mysql.user 
        WHERE (authentication_string = '' OR authentication_string IS NULL)
        AND account_locked = 'N'"
    )
    .fetch_one(pool)
    .await;
    
    let empty_pass_count = match empty_pass_result {
        Ok((count,)) => count as f64,
        Err(_) => 0.0,
    };
    
    metrics.push(HealthMetricDetail {
        id: "sec_empty_pass".to_string(),
        label: "Empty Passwords".to_string(),
        value: format!("{}", empty_pass_count as i32),
        raw_value: empty_pass_count,
        unit: None,
        status: get_status(empty_pass_count, 0.0, 2.0, true),
        weight: 0.35,
        threshold_warning: 0.0,
        threshold_critical: 2.0,
        description: Some("Users with empty or no password".to_string()),
    });
    
    let root_remote_result: Result<(i64,), _> = sqlx::query_as(
        "SELECT COUNT(*) FROM mysql.user WHERE User = 'root' AND Host != 'localhost' AND Host != '127.0.0.1'"
    )
    .fetch_one(pool)
    .await;
    
    let root_remote_count = match root_remote_result {
        Ok((count,)) => count as f64,
        Err(_) => 0.0,
    };
    
    metrics.push(HealthMetricDetail {
        id: "sec_root_remote".to_string(),
        label: "Remote Root Access".to_string(),
        value: if root_remote_count > 0.0 { "Enabled" } else { "Disabled" }.to_string(),
        raw_value: root_remote_count,
        unit: None,
        status: if root_remote_count > 0.0 { "warning" } else { "healthy" }.to_string(),
        weight: 0.25,
        threshold_warning: 0.0,
        threshold_critical: 1.0,
        description: Some("Root user accessible from remote hosts".to_string()),
    });
    
    let super_priv_result: Result<(i64,), _> = sqlx::query_as(
        "SELECT COUNT(*) FROM mysql.user WHERE Super_priv = 'Y'"
    )
    .fetch_one(pool)
    .await;
    
    let super_count = match super_priv_result {
        Ok((count,)) => count as f64,
        Err(_) => 0.0,
    };
    
    metrics.push(HealthMetricDetail {
        id: "sec_all_priv".to_string(),
        label: "Super Privilege Users".to_string(),
        value: format!("{}", super_count as i32),
        raw_value: super_count,
        unit: None,
        status: get_status(super_count, 3.0, 10.0, true),
        weight: 0.20,
        threshold_warning: 3.0,
        threshold_critical: 10.0,
        description: Some("Users with SUPER privilege".to_string()),
    });
    
    let ssl_status: Option<(String,)> = sqlx::query_as(
        "SHOW STATUS LIKE 'Ssl_cipher'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to check SSL status: {}", e))?;
    
    let ssl_enabled = ssl_status
        .map(|(v,)| !v.is_empty())
        .unwrap_or(false);
    
    metrics.push(HealthMetricDetail {
        id: "sec_ssl".to_string(),
        label: "SSL Connections".to_string(),
        value: if ssl_enabled { "Enabled" } else { "Disabled" }.to_string(),
        raw_value: if ssl_enabled { 100.0 } else { 0.0 },
        unit: None,
        status: if ssl_enabled { "healthy" } else { "warning" }.to_string(),
        weight: 0.20,
        threshold_warning: 50.0,
        threshold_critical: 0.0,
        description: Some("Current connection SSL status".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

fn format_bytes(bytes: f64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    const TB: f64 = GB * 1024.0;
    
    if bytes >= TB {
        format!("{:.2} TB", bytes / TB)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes / GB)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes / MB)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes / KB)
    } else {
        format!("{} B", bytes as i64)
    }
}
