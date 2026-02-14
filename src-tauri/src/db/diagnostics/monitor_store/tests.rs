use super::*;
use chrono::{Duration, Utc};
use crate::db_types::ServerStatus;

#[tokio::test]
async fn test_monitor_store_crud() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = MonitorStore::new(pool).await.unwrap();
    
    let status = ServerStatus {
        uptime: 100,
        threads_connected: 5,
        threads_running: 2,
        queries: 1000,
        slow_queries: 1,
        connections: 10,
        bytes_received: 1024,
        bytes_sent: 2048,
    };
    
    store.save_snapshot("conn1", &status).await.unwrap();
    
    let history = store.get_history("conn1", Utc::now() - Duration::minutes(1), Utc::now() + Duration::minutes(1)).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].uptime, 100);
    
    // Alerts
    let alert = MonitorAlert {
        id: None,
        connection_id: "conn1".to_string(),
        metric_name: "qps".to_string(),
        threshold: 100.0,
        operator: ">".to_string(),
        is_enabled: true,
        cooldown_secs: 300,
        last_triggered: None,
    };
    
    let id = store.save_alert(&alert).await.unwrap();
    let alerts = store.get_alerts("conn1").await.unwrap();
    assert_eq!(alerts.len(), 1);
    assert_eq!(alerts[0].metric_name, "qps");
    
    store.mark_alert_triggered(id).await.unwrap();
    let alerts2 = store.get_alerts("conn1").await.unwrap();
    assert!(alerts2[0].last_triggered.is_some());
    
    store.delete_alert(id).await.unwrap();
    assert_eq!(store.get_alerts("conn1").await.unwrap().len(), 0);
}

#[test]
fn test_monitor_alert_evaluate() {
    let mut alert = MonitorAlert {
        id: Some(1),
        connection_id: "conn1".to_string(),
        metric_name: "threads_running".to_string(),
        threshold: 10.0,
        operator: ">".to_string(),
        is_enabled: true,
        cooldown_secs: 60,
        last_triggered: None,
    };
    
    // Below threshold
    assert!(!alert.evaluate(5.0));
    
    // Above threshold, no last_triggered
    assert!(alert.evaluate(15.0));
    
    // Above threshold, within cooldown
    alert.last_triggered = Some(Utc::now() - Duration::seconds(30));
    assert!(!alert.evaluate(15.0));
    
    // Above threshold, outside cooldown
    alert.last_triggered = Some(Utc::now() - Duration::seconds(90));
    assert!(alert.evaluate(15.0));
    
    // Disabled
    alert.is_enabled = false;
    alert.last_triggered = None;
    assert!(!alert.evaluate(15.0));
}

#[test]
fn test_monitor_alert_operators() {
    let mut alert = MonitorAlert {
        id: Some(1),
        connection_id: "conn1".to_string(),
        metric_name: "test".to_string(),
        threshold: 100.0,
        operator: "<".to_string(),
        is_enabled: true,
        cooldown_secs: 0,
        last_triggered: None,
    };
    
    assert!(alert.evaluate(50.0));
    assert!(!alert.evaluate(150.0));
    
    alert.operator = ">=".to_string();
    assert!(alert.evaluate(100.0));
    assert!(alert.evaluate(101.0));
    assert!(!alert.evaluate(99.0));
    
    alert.operator = "<=".to_string();
    assert!(alert.evaluate(100.0));
    assert!(alert.evaluate(99.0));
    assert!(!alert.evaluate(101.0));
}
