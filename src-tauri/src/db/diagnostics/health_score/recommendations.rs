use crate::db_types::{HealthCategory, HealthMetricDetail, HealthRecommendation};

pub fn generate_recommendations(categories: &[HealthCategory]) -> Vec<HealthRecommendation> {
    let mut recommendations = Vec::new();

    for category in categories {
        for metric in &category.metrics {
            if metric.status == "critical" || metric.status == "warning" {
                if let Some(rec) = generate_metric_recommendation(metric, &category.id) {
                    recommendations.push(rec);
                }
            }
        }
    }

    recommendations.sort_by(|a, b| {
        let severity_order = |s: &str| match s {
            "critical" => 0,
            "high" => 1,
            "medium" => 2,
            _ => 3,
        };
        severity_order(&a.severity).cmp(&severity_order(&b.severity))
    });

    recommendations
}

fn generate_metric_recommendation(
    metric: &HealthMetricDetail,
    category: &str,
) -> Option<HealthRecommendation> {
    match metric.id.as_str() {
        "perf_buffer_hit" if metric.raw_value < 95.0 => {
            let severity = if metric.raw_value < 85.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "mysql_buffer_pool_increase".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Increase InnoDB Buffer Pool Size".to_string(),
                description: format!(
                    "Buffer pool hit ratio is {:.1}%, below the optimal 95% threshold. This indicates memory pressure and excessive disk I/O.",
                    metric.raw_value
                ),
                impact: "Increasing buffer pool size could reduce disk I/O by 40-60% and significantly improve query latency.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("SET GLOBAL innodb_buffer_pool_size = {calculated_size};".to_string()),
                action_type: "config".to_string(),
                related_metrics: vec!["perf_buffer_hit".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/innodb-buffer-pool.html".to_string()),
            })
        },
        
        "perf_slow_queries" if metric.raw_value > 10.0 => {
            let severity = if metric.raw_value > 50.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "mysql_slow_queries_optimize".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Optimize Slow Queries".to_string(),
                description: format!(
                    "{:.1} slow queries per minute detected. Review and optimize these queries to improve overall performance.",
                    metric.raw_value
                ),
                impact: "Optimizing slow queries could improve overall throughput by 20-50% and reduce server load.".to_string(),
                effort: "High".to_string(),
                action_sql: None,
                action_type: "monitor".to_string(),
                related_metrics: vec!["perf_slow_queries".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/slow-query-log.html".to_string()),
            })
        },
        
        "perf_full_scan" if metric.raw_value > 10.0 => {
            let severity = if metric.raw_value > 25.0 { "critical" } else { "medium" };
            Some(HealthRecommendation {
                id: "mysql_full_scan_reduce".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Reduce Full Table Scans".to_string(),
                description: format!(
                    "Full table scan ratio is {:.1}%. Missing indexes are causing inefficient queries.",
                    metric.raw_value
                ),
                impact: "Adding appropriate indexes could reduce query execution time by 50-90% for affected queries.".to_string(),
                effort: "Medium".to_string(),
                action_sql: None,
                action_type: "index".to_string(),
                related_metrics: vec!["perf_full_scan".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/mysql-indexes.html".to_string()),
            })
        },
        
        "conn_usage" if metric.raw_value > 70.0 => {
            let severity = if metric.raw_value > 90.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "mysql_connections_increase".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Connection Pool Near Limit".to_string(),
                description: format!(
                    "Connection usage is at {:.1}%. Consider increasing max_connections or implementing connection pooling.",
                    metric.raw_value
                ),
                impact: "Prevents connection refused errors and improves application stability.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("SET GLOBAL max_connections = {new_value};".to_string()),
                action_type: "config".to_string(),
                related_metrics: vec!["conn_usage".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/connection-management.html".to_string()),
            })
        },
        
        "conn_idle" if metric.raw_value > 30.0 => {
            Some(HealthRecommendation {
                id: "mysql_idle_connections_reduce".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Reduce Idle Connections".to_string(),
                description: format!(
                    "{} connections have been idle for more than 1 minute. Configure wait_timeout to release idle connections.",
                    metric.raw_value as i32
                ),
                impact: "Frees up connection slots and reduces memory usage.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("SET GLOBAL wait_timeout = 300;".to_string()),
                action_type: "config".to_string(),
                related_metrics: vec!["conn_idle".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/server-system-variables.html#sysvar_wait_timeout".to_string()),
            })
        },
        
        "stor_bloat" if metric.raw_value > 15.0 => {
            let severity = if metric.raw_value > 30.0 { "high" } else { "medium" };
            Some(HealthRecommendation {
                id: "mysql_table_optimize".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Optimize Fragmented Tables".to_string(),
                description: format!(
                    "Database bloat ratio is {:.1}%. Run OPTIMIZE TABLE on large fragmented tables to reclaim space.",
                    metric.raw_value
                ),
                impact: "Could reclaim wasted disk space and improve read performance by 10-20%.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("OPTIMIZE TABLE table_name;".to_string()),
                action_type: "maintenance".to_string(),
                related_metrics: vec!["stor_bloat".to_string(), "stor_fragmented".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/optimize-table.html".to_string()),
            })
        },
        
        "stor_fragmented" if metric.raw_value > 10.0 => {
            let severity = if metric.raw_value > 25.0 { "high" } else { "medium" };
            Some(HealthRecommendation {
                id: "mysql_fragmented_tables_rebuild".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Rebuild Fragmented Tables".to_string(),
                description: format!(
                    "{} tables have significant fragmentation (>25%). Consider rebuilding them.",
                    metric.raw_value as i32
                ),
                impact: "Rebuilding tables improves sequential read performance and reduces storage usage.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("ALTER TABLE table_name ENGINE=InnoDB;".to_string()),
                action_type: "maintenance".to_string(),
                related_metrics: vec!["stor_fragmented".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/alter-table.html".to_string()),
            })
        },
        
        "maint_unused_idx" if metric.raw_value > 5.0 => {
            Some(HealthRecommendation {
                id: "mysql_unused_indexes_drop".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Remove Unused Indexes".to_string(),
                description: format!(
                    "{} indexes have never been used since server start. They add overhead to write operations.",
                    metric.raw_value as i32
                ),
                impact: "Removing unused indexes reduces write overhead and storage requirements.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("DROP INDEX index_name ON table_name;".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["maint_unused_idx".to_string()],
                documentation_url: None,
            })
        },
        
        "maint_tables_no_pk" if metric.raw_value > 0.0 => {
            let severity = if metric.raw_value > 5.0 { "high" } else { "medium" };
            Some(HealthRecommendation {
                id: "mysql_add_primary_keys".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Add Primary Keys to Tables".to_string(),
                description: format!(
                    "{} tables lack a primary key. This impacts replication efficiency and query performance.",
                    metric.raw_value as i32
                ),
                impact: "Primary keys enable efficient row lookups and are required for proper replication.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("ALTER TABLE table_name ADD PRIMARY KEY (column);".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["maint_tables_no_pk".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/primary-key-optimization.html".to_string()),
            })
        },
        
        "maint_dupe_idx" if metric.raw_value > 3.0 => {
            Some(HealthRecommendation {
                id: "mysql_duplicate_indexes_remove".to_string(),
                category: category.to_string(),
                severity: "low".to_string(),
                title: "Remove Duplicate Indexes".to_string(),
                description: format!(
                    "{} redundant indexes detected. They waste storage and slow down write operations.",
                    metric.raw_value as i32
                ),
                impact: "Removing redundant indexes reduces storage and write overhead.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("DROP INDEX index_name ON table_name;".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["maint_dupe_idx".to_string()],
                documentation_url: None,
            })
        },
        
        "sec_empty_pass" if metric.raw_value > 0.0 => {
            let severity = if metric.raw_value > 2.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "mysql_empty_passwords_fix".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Set Passwords for All Users".to_string(),
                description: format!(
                    "{} users have empty or no password. This is a critical security risk.",
                    metric.raw_value as i32
                ),
                impact: "Eliminates unauthorized access vulnerability.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("ALTER USER 'user'@'host' IDENTIFIED BY 'strong_password';".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["sec_empty_pass".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/alter-user.html".to_string()),
            })
        },
        
        "sec_root_remote" if metric.raw_value > 0.0 => {
            Some(HealthRecommendation {
                id: "mysql_root_remote_disable".to_string(),
                category: category.to_string(),
                severity: "high".to_string(),
                title: "Disable Remote Root Access".to_string(),
                description: "Root user is accessible from remote hosts. Restrict root to localhost only.".to_string(),
                impact: "Reduces attack surface and prevents unauthorized administrative access.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1'); FLUSH PRIVILEGES;".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["sec_root_remote".to_string()],
                documentation_url: None,
            })
        },
        
        "sec_ssl" if metric.raw_value < 50.0 => {
            Some(HealthRecommendation {
                id: "mysql_ssl_enable".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Enable SSL for Database Connections".to_string(),
                description: "SSL is not enabled for database connections. Data is transmitted in plain text.".to_string(),
                impact: "Encrypts data in transit, preventing eavesdropping and man-in-the-middle attacks.".to_string(),
                effort: "Medium".to_string(),
                action_sql: None,
                action_type: "config".to_string(),
                related_metrics: vec!["sec_ssl".to_string()],
                documentation_url: Some("https://dev.mysql.com/doc/refman/8.0/en/using-encrypted-connections.html".to_string()),
            })
        },
        
        // MSSQL-specific recommendations
        "perf_buffer_cache" if metric.raw_value < 95.0 => {
            let severity = if metric.raw_value < 85.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "mssql_buffer_cache_low".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Low Buffer Cache Hit Ratio".to_string(),
                description: format!(
                    "Buffer cache hit ratio is {:.1}%, below optimal 95%. Consider adding more memory.",
                    metric.raw_value
                ),
                impact: "Increasing memory could reduce disk I/O by 50-70% and improve query performance.".to_string(),
                effort: "High".to_string(),
                action_sql: None,
                action_type: "config".to_string(),
                related_metrics: vec!["perf_buffer_cache".to_string()],
                documentation_url: Some("https://learn.microsoft.com/en-us/sql/relational-databases/performance-monitor/sql-server-buffer-manager-object".to_string()),
            })
        },
        
        "perf_page_life" if metric.raw_value < 300.0 => {
            let severity = if metric.raw_value < 100.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "mssql_page_life_low".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Low Page Life Expectancy".to_string(),
                description: format!(
                    "Page life expectancy is {:.0} seconds, indicating memory pressure.",
                    metric.raw_value
                ),
                impact: "Adding memory allows data pages to stay in cache longer, reducing disk reads.".to_string(),
                effort: "High".to_string(),
                action_sql: None,
                action_type: "config".to_string(),
                related_metrics: vec!["perf_page_life".to_string()],
                documentation_url: Some("https://learn.microsoft.com/en-us/sql/relational-databases/performance-monitor/sql-server-buffer-manager-object".to_string()),
            })
        },
        
        "conn_blocked" if metric.raw_value > 0.0 => {
            Some(HealthRecommendation {
                id: "mssql_blocked_processes".to_string(),
                category: category.to_string(),
                severity: "high".to_string(),
                title: "Blocked Processes Detected".to_string(),
                description: format!("{} processes are currently blocked. Investigate blocking chains.", metric.raw_value as i32),
                impact: "Resolving blocking improves throughput and reduces wait times.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("SELECT * FROM sys.dm_exec_requests WHERE blocking_session_id > 0".to_string()),
                action_type: "monitor".to_string(),
                related_metrics: vec!["conn_blocked".to_string()],
                documentation_url: Some("https://learn.microsoft.com/en-us/sql/relational-databases/performance/understand-and-resolve-sql-server-blocking-problems".to_string()),
            })
        },
        
        "stor_fragmented" if metric.raw_value > 10.0 => {
            let severity = if metric.raw_value > 30.0 { "high" } else { "medium" };
            Some(HealthRecommendation {
                id: "mssql_rebuild_indexes".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Rebuild Fragmented Indexes".to_string(),
                description: format!("{} indexes have >30% fragmentation. Rebuild or reorganize them.", metric.raw_value as i32),
                impact: "Rebuilding indexes can improve query performance by 20-50%.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("ALTER INDEX ALL ON table_name REBUILD".to_string()),
                action_type: "maintenance".to_string(),
                related_metrics: vec!["stor_fragmented".to_string()],
                documentation_url: Some("https://learn.microsoft.com/en-us/sql/relational-databases/indexes/reorganize-and-rebuild-indexes".to_string()),
            })
        },
        
        "maint_backups" if metric.raw_value > 0.0 => {
            let severity = if metric.raw_value > 3.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "mssql_backup_databases".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Backup Databases".to_string(),
                description: format!("{} databases have not been backed up in 24+ hours.", metric.raw_value as i32),
                impact: "Regular backups are critical for disaster recovery and data protection.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("BACKUP DATABASE [dbname] TO DISK = 'path'".to_string()),
                action_type: "maintenance".to_string(),
                related_metrics: vec!["maint_backups".to_string()],
                documentation_url: Some("https://learn.microsoft.com/en-us/sql/relational-databases/backup-restore/back-up-and-restore-of-sql-server-databases".to_string()),
            })
        },
        
        "maint_stale_stats" if metric.raw_value > 50.0 => {
            Some(HealthRecommendation {
                id: "mssql_update_statistics".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Update Statistics".to_string(),
                description: format!("{} statistics haven't been updated in 7+ days.", metric.raw_value as i32),
                impact: "Updating statistics improves query plan quality and performance.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("UPDATE STATISTICS table_name WITH FULLSCAN".to_string()),
                action_type: "maintenance".to_string(),
                related_metrics: vec!["maint_stale_stats".to_string()],
                documentation_url: Some("https://learn.microsoft.com/en-us/sql/relational-databases/statistics/update-statistics".to_string()),
            })
        },
        
        "sec_sa_account" if metric.raw_value > 0.0 => {
            Some(HealthRecommendation {
                id: "mssql_disable_sa".to_string(),
                category: category.to_string(),
                severity: "high".to_string(),
                title: "Disable SA Account".to_string(),
                description: "The SA account is enabled. Rename and disable it for security.".to_string(),
                impact: "Disabling SA reduces attack surface and prevents brute force attacks.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("ALTER LOGIN sa DISABLE;".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["sec_sa_account".to_string()],
                documentation_url: Some("https://learn.microsoft.com/en-us/sql/relational-databases/security/securing-sql-server".to_string()),
            })
        },
        
        "sec_sysadmin" if metric.raw_value > 3.0 => {
            Some(HealthRecommendation {
                id: "mssql_review_sysadmin".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Review Sysadmin Membership".to_string(),
                description: format!("{} members have sysadmin privileges. Review for principle of least privilege.", metric.raw_value as i32),
                impact: "Reducing sysadmin members limits potential damage from compromised accounts.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("ALTER SERVER ROLE sysadmin DROP MEMBER [login]".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["sec_sysadmin".to_string()],
                documentation_url: Some("https://learn.microsoft.com/en-us/sql/relational-databases/security/authentication-access/server-level-roles".to_string()),
            })
        },
        
        // PostgreSQL-specific recommendations
        "perf_cache_hit" if metric.raw_value < 95.0 => {
            let severity = if metric.raw_value < 85.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "postgres_cache_hit_low".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Low Cache Hit Ratio".to_string(),
                description: format!("Cache hit ratio is {:.1}%, below optimal 95%. Consider increasing shared_buffers.", metric.raw_value),
                impact: "Increasing shared_buffers could reduce disk I/O by 50-70% and improve query performance.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("ALTER SYSTEM SET shared_buffers = '256MB'; SELECT pg_reload_conf();".to_string()),
                action_type: "config".to_string(),
                related_metrics: vec!["perf_cache_hit".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/runtime-config-resource.html".to_string()),
            })
        },
        
        "perf_index_usage" if metric.raw_value < 90.0 => {
            let severity = if metric.raw_value < 70.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "postgres_index_usage_low".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "Low Index Usage".to_string(),
                description: format!("Index usage ratio is {:.1}%. Many sequential scans suggest missing indexes.", metric.raw_value),
                impact: "Adding appropriate indexes could improve query performance by 50-90%.".to_string(),
                effort: "High".to_string(),
                action_sql: None,
                action_type: "index".to_string(),
                related_metrics: vec!["perf_index_usage".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/indexes.html".to_string()),
            })
        },
        
        "perf_dead_tuples" if metric.raw_value > 10.0 => {
            let severity = if metric.raw_value > 25.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "postgres_dead_tuples_high".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "High Dead Tuple Ratio".to_string(),
                description: format!("Dead tuple ratio is {:.1}%. Tables need vacuuming.", metric.raw_value),
                impact: "Running VACUUM will reclaim space and improve query performance.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("VACUUM ANALYZE;".to_string()),
                action_type: "maintenance".to_string(),
                related_metrics: vec!["perf_dead_tuples".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/routine-vacuuming.html".to_string()),
            })
        },
        
        "conn_usage" if metric.raw_value > 70.0 => {
            let severity = if metric.raw_value > 90.0 { "critical" } else { "high" };
            Some(HealthRecommendation {
                id: "postgres_connections_high".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "High Connection Usage".to_string(),
                description: format!("Connection usage is at {:.1}%. Consider connection pooling.", metric.raw_value),
                impact: "Connection pooling reduces overhead and improves scalability.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("ALTER SYSTEM SET max_connections = 200; SELECT pg_reload_conf();".to_string()),
                action_type: "config".to_string(),
                related_metrics: vec!["conn_usage".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/runtime-config-connection.html".to_string()),
            })
        },
        
        "conn_idle" if metric.raw_value > 20.0 => {
            Some(HealthRecommendation {
                id: "postgres_idle_connections".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Many Idle Connections".to_string(),
                description: format!("{} connections have been idle for more than 5 minutes.", metric.raw_value as i32),
                impact: "Terminating idle connections frees resources for active queries.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < NOW() - INTERVAL '10 minutes';".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["conn_idle".to_string()],
                documentation_url: None,
            })
        },
        
        "stor_bloat" if metric.raw_value > 15.0 => {
            let severity = if metric.raw_value > 30.0 { "high" } else { "medium" };
            Some(HealthRecommendation {
                id: "postgres_bloat_high".to_string(),
                category: category.to_string(),
                severity: severity.to_string(),
                title: "High Table Bloat".to_string(),
                description: format!("Estimated bloat is {:.1}%. Tables need vacuuming.", metric.raw_value),
                impact: "Full vacuum or pg_repack can reclaim wasted space.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("VACUUM FULL table_name;".to_string()),
                action_type: "maintenance".to_string(),
                related_metrics: vec!["stor_bloat".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/sql-vacuum.html".to_string()),
            })
        },
        
        "maint_autovacuum" if metric.raw_value < 50.0 => {
            Some(HealthRecommendation {
                id: "postgres_autovacuum_disabled".to_string(),
                category: category.to_string(),
                severity: "high".to_string(),
                title: "Autovacuum Disabled".to_string(),
                description: "Autovacuum is disabled. Manual vacuuming is required to prevent table bloat.".to_string(),
                impact: "Enabling autovacuum automates maintenance and prevents performance degradation.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("ALTER SYSTEM SET autovacuum = on; SELECT pg_reload_conf();".to_string()),
                action_type: "config".to_string(),
                related_metrics: vec!["maint_autovacuum".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/routine-vacuuming.html#AUTOVACUUM".to_string()),
            })
        },
        
        "maint_stale_vacuum" if metric.raw_value > 50.0 => {
            Some(HealthRecommendation {
                id: "postgres_vacuum_stale".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Tables Need Vacuuming".to_string(),
                description: format!("{} tables haven't been vacuumed in 7+ days.", metric.raw_value as i32),
                impact: "Running vacuum will update statistics and reclaim dead space.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("VACUUM ANALYZE;".to_string()),
                action_type: "maintenance".to_string(),
                related_metrics: vec!["maint_stale_vacuum".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/sql-vacuum.html".to_string()),
            })
        },
        
        "maint_no_pk" if metric.raw_value > 0.0 => {
            Some(HealthRecommendation {
                id: "postgres_add_pk".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Add Primary Keys".to_string(),
                description: format!("{} tables lack a primary key.", metric.raw_value as i32),
                impact: "Primary keys enable efficient row lookups and are required for replication.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("ALTER TABLE table_name ADD PRIMARY KEY (column);".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["maint_no_pk".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/ddl-constraints.html".to_string()),
            })
        },
        
        "maint_unused_idx" if metric.raw_value > 10.0 => {
            Some(HealthRecommendation {
                id: "postgres_unused_indexes".to_string(),
                category: category.to_string(),
                severity: "low".to_string(),
                title: "Remove Unused Indexes".to_string(),
                description: format!("{} indexes have never been used.", metric.raw_value as i32),
                impact: "Removing unused indexes reduces write overhead and storage.".to_string(),
                effort: "Low".to_string(),
                action_sql: Some("DROP INDEX index_name;".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["maint_unused_idx".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/sql-dropindex.html".to_string()),
            })
        },
        
        "sec_superusers" if metric.raw_value > 3.0 => {
            Some(HealthRecommendation {
                id: "postgres_superusers_high".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Review Superuser Roles".to_string(),
                description: format!("{} superuser roles exist. Review for principle of least privilege.", metric.raw_value as i32),
                impact: "Reducing superuser accounts limits potential damage from compromised accounts.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("ALTER ROLE rolename NOSUPERUSER;".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["sec_superusers".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/role-attributes.html".to_string()),
            })
        },
        
        "sec_ssl" if metric.raw_value < 50.0 => {
            Some(HealthRecommendation {
                id: "postgres_ssl_disabled".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Enable SSL Connections".to_string(),
                description: "SSL is not enabled for database connections.".to_string(),
                impact: "SSL encrypts data in transit, preventing eavesdropping.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("ALTER SYSTEM SET ssl = on; SELECT pg_reload_conf();".to_string()),
                action_type: "config".to_string(),
                related_metrics: vec!["sec_ssl".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/ssl-tcp.html".to_string()),
            })
        },
        
        "sec_public" if metric.raw_value > 10.0 => {
            Some(HealthRecommendation {
                id: "postgres_public_grants".to_string(),
                category: category.to_string(),
                severity: "medium".to_string(),
                title: "Revoke Public Schema Access".to_string(),
                description: format!("{} tables have PUBLIC access grants.", metric.raw_value as i32),
                impact: "Revoking PUBLIC access follows principle of least privilege.".to_string(),
                effort: "Medium".to_string(),
                action_sql: Some("REVOKE ALL ON SCHEMA public FROM PUBLIC;".to_string()),
                action_type: "sql".to_string(),
                related_metrics: vec!["sec_public".to_string()],
                documentation_url: Some("https://www.postgresql.org/docs/current/ddl-priv.html".to_string()),
            })
        },
        
        _ => None,
    }
}

pub fn get_quick_fixes(categories: &[HealthCategory]) -> Vec<HealthRecommendation> {
    generate_recommendations(categories)
        .into_iter()
        .filter(|r| r.effort == "Low" && r.action_sql.is_some())
        .collect()
}

#[allow(dead_code)]
pub fn categorize_recommendations(
    recommendations: &[HealthRecommendation],
) -> std::collections::HashMap<String, Vec<&HealthRecommendation>> {
    let mut grouped = std::collections::HashMap::new();

    for rec in recommendations {
        grouped
            .entry(rec.category.clone())
            .or_insert_with(Vec::new)
            .push(rec);
    }

    grouped
}
