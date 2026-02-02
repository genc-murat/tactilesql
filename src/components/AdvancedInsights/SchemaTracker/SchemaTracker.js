import { SchemaTimeline } from './SchemaTimeline.js';
import { SchemaDiffViewer } from './SchemaDiff.js';
import { SchemaTrackerApi } from '../../../api/schemaTracker.js';
import { ThemeManager } from '../../../utils/ThemeManager.js';
import { Dialog } from '../../UI/Dialog.js'; // Assuming basic dialog exists
import { invoke } from '@tauri-apps/api/core';

export function SchemaTracker() {
    const isLight = ThemeManager.getCurrentTheme() === 'light';
    const container = document.createElement('div');
    container.className = `h-full flex flex-col w-full font-sans ${isLight ? 'bg-gray-50 text-gray-800' : 'bg-[#0f1115] text-gray-200'}`;

    // Header
    const header = document.createElement('header');
    header.className = `h-14 border-b ${isLight ? 'border-gray-200 bg-white' : 'border-white/5 bg-[#16191e]'} flex items-center px-6 justify-between shrink-0`;
    header.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20">
                <span class="material-symbols-outlined text-white text-lg">history</span>
            </div>
            <div>
                <h1 class="font-bold text-sm tracking-wide ${isLight ? 'text-gray-800' : 'text-white'}">SCHEMA TRACKER</h1>
                <p class="text-[10px] opacity-60">Track changes, detect drifts, and generate migrations</p>
            </div>
        </div>
        <div class="flex gap-3">
             <div id="connection-status" class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-[10px] font-mono opacity-60">
                <span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                <span>No Connection</span>
            </div>
            <button id="capture-btn" class="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-xs font-bold rounded flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed">
                <span class="material-symbols-outlined text-[16px]">camera_alt</span> Capture Snapshot
            </button>
        </div>
    `;
    container.appendChild(header);

    // Content Area
    const content = document.createElement('div');
    content.className = 'flex-1 flex overflow-hidden';
    container.appendChild(content);

    // --- State ---
    let snapshots = [];
    let selectedSnapshot = null;
    let currentDiff = null;
    let currentMigration = null;
    let currentBreakingChanges = null;
    let activeConnection = null;
    let qualityScores = {}; // Map snapshotId -> average score

    // --- Logic ---
    const loadSnapshots = async () => {
        if (!activeConnection) return;
        try {
            // Updated to use the corrected API method
            snapshots = await SchemaTrackerApi.getSnapshots(activeConnection.id);

            // Fetch Quality Reports to correlate
            // Best effort: get last 50 reports for this connection
            // We need a new API or reuse getQualityReports
            // For now, let's assume we can fetch them. 
            // Ideally we'd have a specific "getScoresBySnapshot" endpoint.
            // Using invoke directly as a workaround if API wrapper missing
            try {
                const reports = await invoke('get_quality_reports', { connectionId: activeConnection.id });
                // Aggregate scores by snapshot ID
                qualityScores = {};
                reports.forEach(r => {
                    if (r.schema_snapshot_id) {
                        if (!qualityScores[r.schema_snapshot_id]) qualityScores[r.schema_snapshot_id] = [];
                        qualityScores[r.schema_snapshot_id].push(r.overall_score);
                    }
                });

                // Average them
                Object.keys(qualityScores).forEach(k => {
                    const scores = qualityScores[k];
                    qualityScores[k] = scores.reduce((a, b) => a + b, 0) / scores.length;
                });
            } catch (ignore) {
                console.warn("Could not fetch quality scores for timeline", ignore);
            }

            render();

            // If we have snapshots and none selected, select the latest
            if (snapshots.length > 0 && !selectedSnapshot) {
                await selectSnapshot(snapshots[0]);
            }
        } catch (e) {
            console.error("Failed to load snapshots", e);
            // Dialog.alert("Failed to load snapshots: " + e, "Error");
        }
    };

    const selectSnapshot = async (snap) => {
        selectedSnapshot = snap;

        // Find previous snapshot (the one AFTER this one in the list, since list is DESC)
        const index = snapshots.findIndex(s => s.id === snap.id);
        const prevSnap = snapshots[index + 1];

        if (prevSnap) {
            try {
                // Perform comparison
                currentDiff = await SchemaTrackerApi.compareSnapshots(prevSnap, snap);

                // Detect breaking changes
                currentBreakingChanges = await SchemaTrackerApi.detectBreakingChanges(currentDiff);

                // Generate migration script
                const dbType = activeConnection.dbType || 'mysql'; // pass actual type
                currentMigration = await SchemaTrackerApi.generateMigration(currentDiff, dbType);

            } catch (e) {
                console.error("Comparison failed", e);
                currentDiff = null;
            }
        } else {
            // First snapshot, no diff (or diff against empty?)
            // For now, treat as "Initial Snapshot" -> New Tables for everything
            // We can fake a diff where everything is new
            currentDiff = {
                new_tables: snap.tables,
                dropped_tables: [],
                modified_tables: []
            };
            currentBreakingChanges = [];
            currentMigration = "-- Initial Snapshot\n-- No previous version to compare against.";
        }

        render();
    };

    const render = () => {
        content.innerHTML = '';

        // 1. Timeline
        const timeline = SchemaTimeline({
            snapshots,
            selectedSnapshotId: selectedSnapshot?.id,
            onSelectSnapshot: (snap) => selectSnapshot(snap),
            qualityScores: qualityScores // New Prop
        });
        content.appendChild(timeline);

        // 2. Diff Viewer
        const diffViewer = SchemaDiffViewer({
            diff: currentDiff,
            migrationScript: currentMigration,
            breakingChanges: currentBreakingChanges
        });
        content.appendChild(diffViewer);

        // Update connection status
        const statusEl = header.querySelector('#connection-status');
        if (activeConnection) {
            statusEl.innerHTML = `
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>${activeConnection.name} (${activeConnection.host})</span>
            `;
        }
    };

    // --- Init ---
    const init = () => {
        const connStr = localStorage.getItem('activeConnection');
        if (connStr) {
            activeConnection = JSON.parse(connStr);
            // Ensure dbType is set (default to mysql if missing in old config?)
            if (!activeConnection.dbType) activeConnection.dbType = 'mysql';
            loadSnapshots();
        }
    };
    init();

    // --- Event Handlers ---
    header.querySelector('#capture-btn').addEventListener('click', async () => {
        if (!activeConnection) {
            alert('No active connection selected in Workbench.');
            return;
        }

        const btn = header.querySelector('#capture-btn');
        const originalHtml = btn.innerHTML;

        try {
            btn.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span> Capturing...`;
            btn.disabled = true;

            await SchemaTrackerApi.captureSnapshot(activeConnection.id);

            // Refresh
            await loadSnapshots();

        } catch (e) {
            console.error("Capture failed", e);
            alert("Failed to capture snapshot: " + e);
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    });

    return container;
}
