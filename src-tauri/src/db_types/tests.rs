use super::*;

#[tokio::test]
async fn test_app_state_default() {
    let state = AppState::default();
    
    // Verify default database type
    assert_eq!(*state.active_db_type.lock().await, DatabaseType::Disconnected);
    
    // Verify pools are initially None
    assert!(state.mysql_pool.lock().await.is_none());
    assert!(state.postgres_pool.lock().await.is_none());
    assert!(state.mssql_pool.lock().await.is_none());
    assert!(state.clickhouse_pool.lock().await.is_none());
    
    // Verify scheduler state
    assert_eq!(
        *state.task_scheduler_state.lock().await,
        crate::task_manager::models::SchedulerState::Running
    );
}

#[test]
fn test_run_status_conversion() {
    use crate::task_manager::models::RunStatus;
    assert_eq!(RunStatus::from_db("success").unwrap(), RunStatus::Success);
    assert_eq!(RunStatus::Success.as_str(), "success");
    assert!(RunStatus::from_db("invalid").is_err());
}

#[test]
fn test_task_type_conversion() {
    use crate::task_manager::models::TaskType;
    assert_eq!(TaskType::from_db("sql_script").unwrap(), TaskType::SqlScript);
    assert_eq!(TaskType::SqlScript.as_str(), "sql_script");
}

#[test]
fn test_task_status_conversion() {
    use crate::task_manager::models::TaskStatus;
    assert_eq!(TaskStatus::from_db("active").unwrap(), TaskStatus::Active);
    assert_eq!(TaskStatus::Active.as_str(), "active");
}
