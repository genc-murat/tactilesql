use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

pub fn start_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        println!("Background Scheduler started.");

        // Loop for periodic tasks
        loop {
            // Check every 60 minutes
            sleep(Duration::from_secs(3600)).await;

            println!("Running background tasks..."); // Logging

            // Task: Heartbeat
            // We just emit an event "background-task-heartbeat" to the frontend.
            // The frontend can decide what to do (e.g. check if it needs to refresh schema).
            let _ = app.emit("background-task-heartbeat", "check_schema");
        }
    });
}
