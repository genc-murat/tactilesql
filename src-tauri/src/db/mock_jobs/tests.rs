use super::*;

#[test]
fn test_mock_data_job_state_to_status() {
    let state = MockDataJobState {
        operation_id: "op1".to_string(),
        status: MOCK_JOB_STATUS_RUNNING.to_string(),
        database: "db".to_string(),
        table: "table".to_string(),
        progress_pct: 45,
        inserted_rows: 450,
        total_rows: 1000,
        seed: Some(12345),
        dry_run: false,
        warnings: vec!["w1".to_string()],
        error: None,
        started_at: "2026-02-15T10:00:00Z".to_string(),
        finished_at: None,
        cancel_requested: false,
        runtime_instance_id: "inst1".to_string(),
    };
    
    let status = state.to_status();
    assert_eq!(status.operation_id, "op1");
    assert_eq!(status.status, MOCK_JOB_STATUS_RUNNING);
    assert_eq!(status.progress_pct, 45);
    assert_eq!(status.inserted_rows, 450);
    assert_eq!(status.total_rows, 1000);
    assert_eq!(status.seed, Some(12345));
    assert_eq!(status.warnings.len(), 1);
}
