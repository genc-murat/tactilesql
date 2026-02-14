use super::*;
use chrono::{Duration as ChronoDuration, Utc};

#[test]
fn test_monitor_alert_evaluation() {
    let mut alert = MonitorAlert {
        id: Some(1),
        connection_id: "conn1".into(),
        metric_name: "threads_running".into(),
        threshold: 10.0,
        operator: ">".into(),
        is_enabled: true,
        cooldown_secs: 60,
        last_triggered: None,
    };

    // Case 1: Below threshold
    assert!(!alert.evaluate(5.0));

    // Case 2: Above threshold, no previous trigger
    assert!(alert.evaluate(15.0));

    // Case 3: Above threshold, within cooldown
    alert.last_triggered = Some(Utc::now() - ChronoDuration::seconds(30));
    assert!(!alert.evaluate(15.0));

    // Case 4: Above threshold, after cooldown
    alert.last_triggered = Some(Utc::now() - ChronoDuration::seconds(90));
    assert!(alert.evaluate(15.0));

    // Case 5: Disabled alert
    alert.is_enabled = false;
    alert.last_triggered = None;
    assert!(!alert.evaluate(100.0));
}

#[test]
fn test_operators() {
    let mut alert = MonitorAlert {
        id: None,
        connection_id: "c".into(),
        metric_name: "m".into(),
        threshold: 100.0,
        operator: "<".into(),
        is_enabled: true,
        cooldown_secs: 0,
        last_triggered: None,
    };

    assert!(alert.evaluate(50.0));
    assert!(!alert.evaluate(150.0));

    alert.operator = ">=".into();
    assert!(alert.evaluate(100.0));
    assert!(alert.evaluate(101.0));
    assert!(!alert.evaluate(99.0));

    alert.operator = "<=".into();
    assert!(alert.evaluate(100.0));
    assert!(alert.evaluate(99.0));
    assert!(!alert.evaluate(101.0));
}

#[tokio::test]
async fn test_monitor_store_crud() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = MonitorStore::new(pool).await.unwrap();
    
    let alert = MonitorAlert {
        id: None,
        connection_id: "conn1".into(),
        metric_name: "cpu".into(),
        threshold: 80.0,
        operator: ">".into(),
        is_enabled: true,
        cooldown_secs: 300,
        last_triggered: None,
    };
    
    let id = store.save_alert(&alert).await.unwrap();
    let alerts = store.get_alerts("conn1").await.unwrap();
    assert_eq!(alerts.len(), 1);
    assert_eq!(alerts[0].metric_name, "cpu");
    
    store.mark_alert_triggered(id).await.unwrap();
    let updated = store.get_alerts("conn1").await.unwrap();
    assert!(updated[0].last_triggered.is_some());
    
    store.delete_alert(id).await.unwrap();
    let empty = store.get_alerts("conn1").await.unwrap();
    assert!(empty.is_empty());
}
