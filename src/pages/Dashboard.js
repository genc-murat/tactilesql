import { MainLayout } from '../components/Layout/MainLayout.js';
import { KPISection } from '../components/Dashboard/KPISection.js';
import { ClusterOverview } from '../components/Dashboard/ClusterOverview.js';
import { QueryTable } from '../components/Dashboard/QueryTable.js';

export function Dashboard() {
    // Check connection first
    const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');

    if (!activeConfig) {
        // Redirect if no connection
        window.location.hash = '/connections';
        const emptyState = document.createElement('div');
        emptyState.className = "p-8 text-gray-500 italic";
        emptyState.innerText = "Redirecting to connections...";
        return emptyState;
    }

    const container = document.createElement('div');
    container.className = "flex flex-col gap-6 p-6 h-full overflow-y-auto custom-scrollbar";

    // Components
    const kpiSection = KPISection();
    const clusterOverview = ClusterOverview();
    const queryTable = QueryTable();

    container.appendChild(kpiSection.element);
    container.appendChild(clusterOverview.element);
    container.appendChild(queryTable.element);

    // --- Data Fetching ---
    let intervalId = null;

    const fetchData = async () => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');

            if (!activeConfig) return;

            // 1. Global Status (KPIs)
            // Use Promise.all for parallelism
            const [statusResult, dbSizesResult, processListResult] = await Promise.all([
                invoke('execute_query', { query: `SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected', 'Bytes_received', 'Bytes_sent', 'Uptime', 'Innodb_buffer_pool_bytes_data');` }),
                invoke('execute_query', {
                    query: `
                    SELECT table_schema, 
                           SUM(data_length + index_length) as size_bytes, 
                           COUNT(*) as table_count 
                    FROM information_schema.tables 
                    GROUP BY table_schema;`
                }),
                invoke('execute_query', { query: `SELECT * FROM information_schema.processlist ORDER BY TIME DESC LIMIT 10;` })
            ]);

            // Update Components
            if (statusResult.rows) kpiSection.update(statusResult.rows);
            if (dbSizesResult.rows) clusterOverview.update(dbSizesResult.rows);
            if (processListResult.rows) queryTable.update(processListResult.rows);

        } catch (error) {
            console.error("Dashboard Fetch Error:", error);
            const errString = String(error);
            if (errString.includes("No active connection") || errString.includes("driver not found")) {
                // Backend session lost, but localStorage has config.
                // Clear and redirect.
                localStorage.removeItem('activeConnection');
                clearInterval(intervalId);
                window.location.hash = '/connections';
            }
        }
    };

    // Lifecycle
    setTimeout(fetchData, 100); // Initial fetch
    intervalId = setInterval(fetchData, 5000); // Poll every 5s

    // Cleanup on remove (Observer would be better, but basic for now)
    // In a vanilla JS app, we rely on the router to tear down or manual cleanup. 
    // Since we return a DOM node, we can attach a disconnect observer if needed.
    // For now, we'll attach the interval ID to the container for manual cleanup if the router supports it.
    container.dataset.intervalId = intervalId;

    // Monkey patch unmount for our router to call
    container.onUnmount = () => clearInterval(intervalId);

    return container;
}
