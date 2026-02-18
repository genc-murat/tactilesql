use crate::db_types::{HealthCategory, HealthMetricDetail};
use deadpool_tiberius::Pool;
use futures::TryStreamExt;
use tiberius::QueryItem;

pub struct MssqlHealthConfig {
    pub perf_weight: f32,
    pub conn_weight: f32,
    pub stor_weight: f32,
    pub maint_weight: f32,
    pub sec_weight: f32,
}

impl Default for MssqlHealthConfig {
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

pub async fn collect_mssql_health_metrics(
    pool: &Pool,
    config: &MssqlHealthConfig,
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

async fn query_single_value(pool: &Pool, query: &str) -> Result<i64, String> {
    let mut conn = pool.get().await.map_err(|e| e.to_string())?;
    let mut stream = conn.query(query, &[]).await.map_err(|e| e.to_string())?;
    
    let value = if let Some(QueryItem::Row(row)) = stream.try_next().await.map_err(|e| e.to_string())? {
        row.get::<i64, _>(0).unwrap_or(0)
    } else { 0 };
    
    while stream.try_next().await.map_err(|e| e.to_string())?.is_some() {}
    
    Ok(value)
}

async fn query_single_float(pool: &Pool, query: &str) -> Result<f64, String> {
    let mut conn = pool.get().await.map_err(|e| e.to_string())?;
    let mut stream = conn.query(query, &[]).await.map_err(|e| e.to_string())?;
    
    let value = if let Some(QueryItem::Row(row)) = stream.try_next().await.map_err(|e| e.to_string())? {
        row.get::<f64, _>(0).unwrap_or(0.0)
    } else { 0.0 };
    
    while stream.try_next().await.map_err(|e| e.to_string())?.is_some() {}
    
    Ok(value)
}

async fn collect_performance_metrics(pool: &Pool) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let perf_query = "
        SELECT 
            RTRIM(counter_name) as counter_name,
            cntr_value
        FROM sys.dm_os_performance_counters
        WHERE counter_name IN (
            'Buffer cache hit ratio',
            'Buffer cache hit ratio base',
            'Page life expectancy',
            'Batch Requests/sec',
            'SQL Compilations/sec',
            'Pending disk IO count'
        )
        AND (instance_name = '' OR instance_name = '_Total')
    ";
    
    let mut conn = pool.get().await.map_err(|e| e.to_string())?;
    let mut stream = conn.query(perf_query, &[]).await.map_err(|e| e.to_string())?;
    
    let mut counters: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    
    while let Some(item) = stream.try_next().await.map_err(|e| e.to_string())? {
        if let QueryItem::Row(row) = item {
            let counter_name: String = row.get::<&str, _>(0).unwrap_or("").to_string();
            let value: f64 = row.get::<i64, _>(1).unwrap_or(0) as f64;
            counters.insert(counter_name, value);
        }
    }
    
    let buffer_hit = counters.get("Buffer cache hit ratio").copied().unwrap_or(0.0);
    let buffer_base = counters.get("Buffer cache hit ratio base").copied().unwrap_or(1.0);
    let buffer_hit_ratio = if buffer_base > 0.0 { (buffer_hit / buffer_base) * 100.0 } else { 0.0 };
    
    metrics.push(HealthMetricDetail {
        id: "perf_buffer_cache".to_string(),
        label: "Buffer Cache Hit Ratio".to_string(),
        value: format!("{:.1}%", buffer_hit_ratio),
        raw_value: buffer_hit_ratio,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(buffer_hit_ratio, 95.0, 85.0, false),
        weight: 0.30,
        threshold_warning: 95.0,
        threshold_critical: 85.0,
        description: Some("Percentage of data pages found in buffer pool".to_string()),
    });
    
    let ple = counters.get("Page life expectancy").copied().unwrap_or(0.0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_page_life".to_string(),
        label: "Page Life Expectancy".to_string(),
        value: format!("{:.0} sec", ple),
        raw_value: ple,
        unit: Some("sec".to_string()),
        status: super::scoring::get_status(ple, 300.0, 100.0, true),
        weight: 0.25,
        threshold_warning: 300.0,
        threshold_critical: 100.0,
        description: Some("Seconds a data page stays in buffer pool".to_string()),
    });
    
    let batch_req = counters.get("Batch Requests/sec").copied().unwrap_or(0.0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_batch_requests".to_string(),
        label: "Batch Requests/sec".to_string(),
        value: format!("{:.0}", batch_req),
        raw_value: batch_req,
        unit: Some("/sec".to_string()),
        status: "healthy".to_string(),
        weight: 0.15,
        threshold_warning: 10000.0,
        threshold_critical: 50000.0,
        description: Some("Number of Transact-SQL command batches per second".to_string()),
    });
    
    let sql_comp = counters.get("SQL Compilations/sec").copied().unwrap_or(0.0);
    let comp_ratio = if batch_req > 0.0 { (sql_comp / batch_req) * 100.0 } else { 0.0 };
    
    metrics.push(HealthMetricDetail {
        id: "perf_sql_comp".to_string(),
        label: "SQL Compilation Ratio".to_string(),
        value: format!("{:.1}%", comp_ratio),
        raw_value: comp_ratio,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(comp_ratio, 10.0, 25.0, true),
        weight: 0.15,
        threshold_warning: 10.0,
        threshold_critical: 25.0,
        description: Some("High compilation ratio indicates plan cache pressure".to_string()),
    });
    
    let pending_io = counters.get("Pending disk IO count").copied().unwrap_or(0.0);
    
    metrics.push(HealthMetricDetail {
        id: "perf_pending_io".to_string(),
        label: "Pending Disk I/O".to_string(),
        value: format!("{:.0}", pending_io),
        raw_value: pending_io,
        unit: None,
        status: super::scoring::get_status(pending_io, 20.0, 50.0, true),
        weight: 0.15,
        threshold_warning: 20.0,
        threshold_critical: 50.0,
        description: Some("Number of pending disk I/O operations".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_connection_metrics(pool: &Pool) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let conn_count = query_single_value(pool, "SELECT COUNT(*) FROM sys.dm_exec_connections").await?;
    let max_conn = query_single_value(pool, "SELECT CAST(value_in_use AS BIGINT) FROM sys.configurations WHERE name = 'user connections'").await?;
    let max_conn = if max_conn == 0 { 32767 } else { max_conn };
    
    let conn_usage = if max_conn > 0 { (conn_count as f64 / max_conn as f64) * 100.0 } else { 0.0 };
    
    metrics.push(HealthMetricDetail {
        id: "conn_usage".to_string(),
        label: "Connection Usage".to_string(),
        value: format!("{}/{}", conn_count, max_conn),
        raw_value: conn_usage,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(conn_usage, 70.0, 90.0, true),
        weight: 0.40,
        threshold_warning: 70.0,
        threshold_critical: 90.0,
        description: Some(format!("Using {:.1}% of max connections", conn_usage)),
    });
    
    let blocked_count = query_single_value(pool, "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id > 0").await?;
    
    metrics.push(HealthMetricDetail {
        id: "conn_blocked".to_string(),
        label: "Blocked Processes".to_string(),
        value: format!("{}", blocked_count),
        raw_value: blocked_count as f64,
        unit: None,
        status: super::scoring::get_status(blocked_count as f64, 0.0, 5.0, true),
        weight: 0.30,
        threshold_warning: 0.0,
        threshold_critical: 5.0,
        description: Some("Currently blocked sessions".to_string()),
    });
    
    let waiting_count = query_single_value(pool, "
        SELECT COUNT(*) 
        FROM sys.dm_exec_requests r
        JOIN sys.dm_os_waiting_tasks w ON r.session_id = w.session_id
        WHERE r.status = 'suspended'
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "conn_waiting".to_string(),
        label: "Waiting Sessions".to_string(),
        value: format!("{}", waiting_count),
        raw_value: waiting_count as f64,
        unit: None,
        status: super::scoring::get_status(waiting_count as f64, 10.0, 30.0, true),
        weight: 0.30,
        threshold_warning: 10.0,
        threshold_critical: 30.0,
        description: Some("Sessions waiting on resources".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_storage_metrics(pool: &Pool) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let total_size_gb = query_single_float(pool, "
        SELECT ISNULL(SUM(CAST(size AS FLOAT) * 8.0 / 1024.0 / 1024.0), 0) as size_gb
        FROM sys.master_files
        WHERE database_id > 4
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "stor_total_size".to_string(),
        label: "Total Database Size".to_string(),
        value: format!("{:.2} GB", total_size_gb),
        raw_value: total_size_gb,
        unit: Some("GB".to_string()),
        status: "healthy".to_string(),
        weight: 0.25,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Total size of all user databases".to_string()),
    });
    
    let db_count = query_single_value(pool, "SELECT COUNT(*) FROM sys.databases WHERE database_id > 4").await?;
    let waiting = query_single_value(pool, "
        SELECT COUNT(*) 
        FROM sys.databases
        WHERE database_id > 4
        AND log_reuse_wait_desc != 'NOTHING'
    ").await?;
    
    let log_wait_pct = if db_count > 0 { (waiting as f64 / db_count as f64) * 100.0 } else { 0.0 };
    
    metrics.push(HealthMetricDetail {
        id: "stor_log_wait".to_string(),
        label: "Log Wait Issues".to_string(),
        value: format!("{} of {}", waiting, db_count),
        raw_value: log_wait_pct,
        unit: Some("%".to_string()),
        status: super::scoring::get_status(log_wait_pct, 10.0, 30.0, true),
        weight: 0.25,
        threshold_warning: 10.0,
        threshold_critical: 30.0,
        description: Some("Databases with log reuse wait issues".to_string()),
    });
    
    let frag_count = query_single_value(pool, "
        SELECT COUNT(*)
        FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
        JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
        WHERE ips.avg_fragmentation_in_percent > 30
        AND ips.page_count > 1000
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "stor_fragmented".to_string(),
        label: "Fragmented Indexes".to_string(),
        value: format!("{}", frag_count),
        raw_value: frag_count as f64,
        unit: None,
        status: super::scoring::get_status(frag_count as f64, 10.0, 30.0, true),
        weight: 0.30,
        threshold_warning: 10.0,
        threshold_critical: 30.0,
        description: Some("Indexes with >30% fragmentation".to_string()),
    });
    
    metrics.push(HealthMetricDetail {
        id: "stor_databases".to_string(),
        label: "User Databases".to_string(),
        value: format!("{}", db_count),
        raw_value: db_count as f64,
        unit: None,
        status: "healthy".to_string(),
        weight: 0.20,
        threshold_warning: f64::MAX,
        threshold_critical: f64::MAX,
        description: Some("Number of user databases".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_maintenance_metrics(pool: &Pool) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let stale_stats = query_single_value(pool, "
        SELECT COUNT(*)
        FROM sys.stats s
        JOIN sys.objects o ON s.object_id = o.object_id
        WHERE o.type = 'U'
        AND STATS_DATE(s.object_id, s.stats_id) < DATEADD(day, -7, GETDATE())
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "maint_stale_stats".to_string(),
        label: "Stale Statistics".to_string(),
        value: format!("{}", stale_stats),
        raw_value: stale_stats as f64,
        unit: None,
        status: super::scoring::get_status(stale_stats as f64, 50.0, 200.0, true),
        weight: 0.30,
        threshold_warning: 50.0,
        threshold_critical: 200.0,
        description: Some("Statistics not updated in 7+ days".to_string()),
    });
    
    let no_backup = query_single_value(pool, "
        SELECT COUNT(*)
        FROM sys.databases d
        LEFT JOIN msdb.dbo.backupset b ON d.name = b.database_name AND b.type = 'D'
        WHERE d.database_id > 4
        AND d.state = 0
        AND (b.backup_finish_date IS NULL OR b.backup_finish_date < DATEADD(day, -1, GETDATE()))
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "maint_backups".to_string(),
        label: "Databases Without Recent Backup".to_string(),
        value: format!("{}", no_backup),
        raw_value: no_backup as f64,
        unit: None,
        status: super::scoring::get_status(no_backup as f64, 0.0, 3.0, true),
        weight: 0.40,
        threshold_warning: 0.0,
        threshold_critical: 3.0,
        description: Some("Databases without backup in 24+ hours".to_string()),
    });
    
    let old_compat = query_single_value(pool, "
        SELECT COUNT(*)
        FROM sys.databases
        WHERE database_id > 4
        AND compatibility_level < 140
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "maint_compat".to_string(),
        label: "Old Compatibility Level".to_string(),
        value: format!("{}", old_compat),
        raw_value: old_compat as f64,
        unit: None,
        status: super::scoring::get_status(old_compat as f64, 0.0, 5.0, true),
        weight: 0.30,
        threshold_warning: 0.0,
        threshold_critical: 5.0,
        description: Some("Databases with compatibility level < 140".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}

async fn collect_security_metrics(pool: &Pool) -> Result<CategoryResult, String> {
    let mut metrics = Vec::new();
    
    let mixed_mode = query_single_value(pool, "
        SELECT CAST(value_in_use AS BIGINT) FROM sys.configurations WHERE name = 'show advanced options'
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "sec_auth_mode".to_string(),
        label: "Authentication Mode".to_string(),
        value: if mixed_mode == 1 { "Mixed Mode" } else { "Windows Only" }.to_string(),
        raw_value: if mixed_mode == 1 { 50.0 } else { 100.0 },
        unit: None,
        status: if mixed_mode == 1 { "warning" } else { "healthy" }.to_string(),
        weight: 0.20,
        threshold_warning: 50.0,
        threshold_critical: 0.0,
        description: Some("Mixed mode allows SQL authentication".to_string()),
    });
    
    let sa_enabled = query_single_value(pool, "
        SELECT COUNT(*) FROM sys.server_principals 
        WHERE name = 'sa' AND is_disabled = 0
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "sec_sa_account".to_string(),
        label: "SA Account Status".to_string(),
        value: if sa_enabled > 0 { "Enabled" } else { "Disabled" }.to_string(),
        raw_value: sa_enabled as f64,
        unit: None,
        status: if sa_enabled > 0 { "warning" } else { "healthy" }.to_string(),
        weight: 0.25,
        threshold_warning: 0.0,
        threshold_critical: 1.0,
        description: Some("SA account should be disabled".to_string()),
    });
    
    let sysadmin_count = query_single_value(pool, "
        SELECT COUNT(*) FROM sys.server_principals p
        JOIN sys.server_role_members m ON p.principal_id = m.member_principal_id
        JOIN sys.server_principals r ON m.role_principal_id = r.principal_id
        WHERE r.name = 'sysadmin' AND p.type IN ('S', 'U')
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "sec_sysadmin".to_string(),
        label: "Sysadmin Members".to_string(),
        value: format!("{}", sysadmin_count),
        raw_value: sysadmin_count as f64,
        unit: None,
        status: super::scoring::get_status(sysadmin_count as f64, 3.0, 10.0, true),
        weight: 0.25,
        threshold_warning: 3.0,
        threshold_critical: 10.0,
        description: Some("Number of sysadmin role members".to_string()),
    });
    
    let weak_policy = query_single_value(pool, "
        SELECT COUNT(*) FROM sys.sql_logins 
        WHERE is_policy_checked = 0 OR is_expiration_checked = 0
    ").await?;
    
    metrics.push(HealthMetricDetail {
        id: "sec_weak_policy".to_string(),
        label: "Weak Password Policy".to_string(),
        value: format!("{}", weak_policy),
        raw_value: weak_policy as f64,
        unit: None,
        status: super::scoring::get_status(weak_policy as f64, 0.0, 5.0, true),
        weight: 0.30,
        threshold_warning: 0.0,
        threshold_critical: 5.0,
        description: Some("Logins without password policy checks".to_string()),
    });
    
    Ok(CategoryResult { metrics })
}
