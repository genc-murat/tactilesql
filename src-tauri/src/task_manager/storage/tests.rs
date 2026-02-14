use super::*;
use crate::task_manager::models::{TaskTrigger, TriggerType, MisfirePolicy, RetryPolicy};
use chrono::{Duration, Utc};

#[test]
fn test_compute_misfire_skip_next_run_interval() {
    let now = Utc::now();
    let trigger = TaskTrigger {
        id: "t1".to_string(),
        task_id: "task1".to_string(),
        trigger_type: TriggerType::Interval,
        cron_expression: None,
        interval_seconds: Some(60),
        run_at: None,
        timezone: None,
        misfire_policy: MisfirePolicy::Skip,
        retry_policy: RetryPolicy::default(),
        enabled: true,
        next_run_at: Some(now - Duration::seconds(150)), // Missed 2 ticks
        last_run_at: None,
        claim_owner: None,
        claim_until: None,
        created_at: now,
        updated_at: now,
    };
    
    let next = compute_misfire_skip_next_run(&trigger, now).unwrap().unwrap();
    // Base was -150. Ticks at -90, -30, +30. 
    // Skip policy should advance to the first tick in the future.
    assert!(next > now);
    assert_eq!(next, trigger.next_run_at.unwrap() + Duration::seconds(180));
}

#[tokio::test]
async fn test_task_manager_store_basic() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = TaskManagerStore::new(pool).await.unwrap();
    
    let req = CreateTaskRequest {
        name: "Test Task".to_string(),
        description: None,
        task_type: TaskType::SqlScript,
        status: TaskStatus::Active,
        payload: serde_json::json!({"sql": "SELECT 1"}),
        tags: vec!["test".to_string()],
        owner: None,
    };
    
    let task = store.create_task(req).await.unwrap();
    assert_eq!(task.name, "Test Task");
    
    let fetched = store.get_task(&task.id).await.unwrap().unwrap();
    assert_eq!(fetched.id, task.id);
    
    // Triggers
    let t_req = CreateTaskTriggerRequest {
        task_id: task.id.clone(),
        trigger_type: TriggerType::Interval,
        cron_expression: None,
        interval_seconds: Some(3600),
        run_at: None,
        timezone: None,
        misfire_policy: MisfirePolicy::FireNow,
        retry_policy: RetryPolicy::default(),
        enabled: true,
    };
    
    let trigger = store.create_trigger(t_req).await.unwrap();
    assert_eq!(trigger.task_id, task.id);
    
    let triggers = store.list_triggers(ListTaskTriggersRequest {
        task_id: Some(task.id.clone()),
        ..Default::default()
    }).await.unwrap();
    assert_eq!(triggers.len(), 1);
}
