import { SchemaTimeline } from './SchemaTimeline.js';
import { SchemaDiffViewer } from './SchemaDiff.js';
import { StoryPanel } from './StoryPanel.js';
import { SchemaTrackerApi } from '../../../api/schemaTracker.js';
import { ThemeManager } from '../../../utils/ThemeManager.js';
import { Dialog } from '../../UI/Dialog.js'; // Assuming basic dialog exists
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function SchemaTracker() {
    let theme = ThemeManager.getCurrentTheme();

    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';
        const isNeon = t === 'neon';

        return {
            container: `h-full flex flex-col w-full font-sans transition-colors duration-300 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-bg' : (t === 'oceanic' ? 'bg-[#2E3440]' : (t === 'ember' ? 'bg-[#140c12]' : (t === 'aurora' ? 'bg-[#0b1214]' : 'bg-[#0a0c10]')))))}`,
            header: `h-14 border-b flex items-center px-6 justify-between shrink-0 transition-colors duration-300 ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isNeon ? 'bg-neon-panel border-neon-border/30' : (t === 'oceanic' ? 'border-[#4C566A] bg-[#3B4252]' : (t === 'ember' ? 'border-[#2c1c27] bg-[#1d141c]' : (t === 'aurora' ? 'border-[#1b2e33] bg-[#0f1a1d]' : 'border-white/5 bg-[#13161b]')))))}`,
            title: `font-bold text-sm tracking-wide ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))}`,
            subtitle: `text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400'))}`,
            status: `flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-mono transition-colors duration-300 ${isLight ? 'bg-gray-50 border-gray-200 text-gray-500' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#9893a5]' : (isNeon ? 'bg-neon-bg border-neon-border/40 text-neon-text' : 'bg-white/5 border-white/5 text-gray-400'))}`,
            button: `px-4 py-1.5 text-xs font-bold rounded flex items-center gap-2 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${isDawn ? 'bg-[#ea9d34] text-[#fffaf3] hover:bg-[#d7821a] shadow-[#ea9d34]/20' : (isNeon ? 'bg-cyan-400 text-black shadow-[0_0_15px_rgba(0,243,255,0.4)] hover:bg-cyan-300' : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white shadow-blue-500/20')}`,
            content: `flex-1 flex overflow-hidden`,
            tabBar: `flex items-center px-4 border-b transition-colors duration-300 ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'bg-neon-bg border-neon-border/20' : (t === 'oceanic' ? 'border-[#4C566A] bg-[#3B4252]' : (t === 'ember' ? 'border-[#2c1c27] bg-[#1d141c]' : (t === 'aurora' ? 'border-[#1b2e33] bg-[#0f1a1d]' : 'border-white/5 bg-[#0a0c10]')))))}`,
            tabBtn: (active, type) => {
                let accentColor = 'border-blue-500 text-blue-500';
                if (type === 'story') accentColor = 'border-purple-500 text-purple-500';
                if (isNeon) {
                    accentColor = type === 'story' ? 'border-neon-pink text-neon-pink' : 'border-cyan-400 text-cyan-400';
                }
                const colors = active ? accentColor : (isNeon ? 'border-transparent text-neon-text/40 hover:text-neon-text' : 'border-transparent opacity-60 hover:opacity-100');
                return `px-4 py-3 text-xs font-bold border-b-2 transition-all ${colors}`;
            },
            mainPanel: `flex-1 flex flex-col min-w-0 transition-colors duration-300 ${isLight ? 'bg-white' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-bg' : (t === 'oceanic' ? 'bg-[#2E3440]' : (t === 'ember' ? 'bg-[#140c12]' : (t === 'aurora' ? 'bg-[#0b1214]' : 'bg-[#0a0c10]')))))}`
        };
    };

    let classes = getClasses(theme);
    const container = document.createElement('div');
    container.className = classes.container;

    // Content container for sub-parts to be re-rendered
    const subContainer = document.createElement('div');
    subContainer.className = 'absolute inset-0 flex flex-col';
    container.style.position = 'relative';
    container.appendChild(subContainer);

    // --- State ---
    let snapshots = [];
    let selectedSnapshot = null;
    let currentDiff = null;
    let currentMigration = null;
    let currentBreakingChanges = null;
    let currentStory = null;
    let isStoryLoading = false;
    let activeTab = 'diff'; // 'diff' | 'story'
    let activeConnection = null;
    let comparisonBaseSnapshotId = null;
    let comparisonTargetSnapshotId = null;
    let qualityScores = {};
    let availableDatabases = [];
    let selectedDatabase = null;
    let isDbSelectorOpen = false;

    // --- Logic ---
    const loadSnapshots = async () => {
        if (!activeConnection) return;
        try {
            // Load databases/schemas
            try {
                if (activeConnection.dbType === 'postgresql' || activeConnection.db_type === 'postgresql') {
                    availableDatabases = await invoke('get_schemas');
                } else {
                    availableDatabases = await invoke('get_databases');
                }
                if (!selectedDatabase && availableDatabases.length > 0) {
                    // Try to match active connection database if possible, or default
                    if (activeConnection.database && availableDatabases.includes(activeConnection.database)) {
                        selectedDatabase = activeConnection.database;
                    } else if (availableDatabases.includes('public')) {
                        selectedDatabase = 'public';
                    } else {
                        selectedDatabase = availableDatabases[0];
                    }
                }
            } catch (e) {
                console.warn("Failed to load databases", e);
                availableDatabases = [];
            }

            snapshots = await SchemaTrackerApi.getSnapshots(activeConnection.id, selectedDatabase);
            try {
                const reports = await invoke('get_quality_reports', { connectionId: activeConnection.id });
                qualityScores = {};
                reports.forEach(r => {
                    if (r.schema_snapshot_id) {
                        if (!qualityScores[r.schema_snapshot_id]) qualityScores[r.schema_snapshot_id] = [];
                        qualityScores[r.schema_snapshot_id].push(r.overall_score);
                    }
                });
                Object.keys(qualityScores).forEach(k => {
                    const scores = qualityScores[k];
                    qualityScores[k] = scores.reduce((a, b) => a + b, 0) / scores.length;
                });
            } catch (ignore) { }
            render();
            if (snapshots.length > 0 && !selectedSnapshot) {
                await selectSnapshot(snapshots[0]);
            } else if (snapshots.length === 0) {
                selectedSnapshot = null;
                currentDiff = null;
                currentStory = null;
            }
        } catch (e) {
            console.error("Failed to load snapshots", e);
        }
    };

    const selectSnapshot = async (snap) => {
        selectedSnapshot = snap;
        const index = snapshots.findIndex(s => s.id === snap.id);
        const prevSnap = snapshots[index + 1];

        if (prevSnap) {
            comparisonBaseSnapshotId = prevSnap.id ?? null;
            comparisonTargetSnapshotId = snap.id ?? null;
            try {
                currentDiff = await SchemaTrackerApi.compareSnapshots(prevSnap, snap);
                currentBreakingChanges = await SchemaTrackerApi.detectBreakingChanges(currentDiff);
                const dbType = activeConnection?.dbType || 'mysql';
                currentMigration = await SchemaTrackerApi.generateMigration(currentDiff, dbType);

                isStoryLoading = true;
                render();
                try {
                    currentStory = await SchemaTrackerApi.generateStory(prevSnap, snap);
                } catch (err) {
                    currentStory = null;
                }
                isStoryLoading = false;
            } catch (e) {
                currentDiff = null;
                currentStory = null;
                isStoryLoading = false;
            }
        } else {
            comparisonBaseSnapshotId = null;
            comparisonTargetSnapshotId = snap.id ?? null;
            currentDiff = { new_tables: snap.tables, dropped_tables: [], modified_tables: [] };
            currentBreakingChanges = [];
            currentMigration = "-- Initial Snapshot\n-- No previous version to compare against.";
        }
        render();
    };

    const captureSnapshot = async () => {
        if (!activeConnection) {
            Dialog.alert('No active connection selected.', 'Warning');
            return;
        }
        try {
            const btn = container.querySelector('#capture-btn');
            if (btn) {
                btn.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span> Capturing...`;
                btn.disabled = true;
            }
            // Pass selectedDatabase provided it's not null/empty
            await SchemaTrackerApi.captureSnapshot(activeConnection.id, selectedDatabase || undefined);
            await loadSnapshots();
        } catch (e) {
            Dialog.alert("Capture failed: " + e, "Error");
        } finally {
            render();
        }
    };

    const render = () => {
        subContainer.innerHTML = '';
        classes = getClasses(theme);
        container.className = classes.container;

        // Header
        const header = document.createElement('header');
        header.className = classes.header;
        header.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="p-2 rounded-lg bg-gradient-to-br ${theme === 'dawn' ? 'from-[#ea9d34] to-[#d7827e]' : (theme === 'neon' ? 'from-neon-pink to-cyan-400' : 'from-blue-500 to-indigo-600')} shadow-lg ${theme === 'neon' ? 'shadow-neon-pink/20' : 'shadow-blue-500/20'}">
                    <span class="material-symbols-outlined text-white text-lg">history</span>
                </div>
                <div>
                    <h1 class="${classes.title}">SCHEMA TRACKER</h1>
                    <p class="${classes.subtitle}">Track changes, detect drifts, and generate migrations</p>
                </div>
            </div>
            <div class="flex gap-3 items-center">
                 <div id="connection-status" class="${classes.status}">
                    <span class="w-1.5 h-1.5 rounded-full ${activeConnection ? 'bg-emerald-500 animate-pulse' : 'bg-gray-500'}"></span>
                    <span>${activeConnection ? `${activeConnection.name} (${activeConnection.host})` : 'No Connection'}</span>
                </div>

                ${availableDatabases.length > 0 ? `
                <div class="relative">
                    <button id="db-select-btn" class="flex items-center gap-2 px-3 py-1.5 rounded border text-[11px] font-bold transition-all ${theme === 'light' ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}">
                        <span class="material-symbols-outlined text-[14px] text-gray-400">database</span>
                        <span>${selectedDatabase || 'Select DB'}</span>
                        <span class="material-symbols-outlined text-[14px] text-gray-500 transition-transform duration-200 ${isDbSelectorOpen ? 'rotate-180' : ''}">expand_more</span>
                    </button>
                    ${isDbSelectorOpen ? `
                    <div class="absolute right-0 top-full mt-1 w-48 max-h-60 overflow-y-auto rounded-lg border shadow-xl z-50 overflow-hidden ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-[#1a1d23] border-white/10'} animate-in fade-in slide-in-from-top-1 duration-100">
                        <div class="py-1">
                            ${availableDatabases.map(db => `
                                <button class="db-option w-full text-left px-3 py-1.5 text-[11px] transition-colors flex items-center gap-2 ${db === selectedDatabase ? (theme === 'light' ? 'bg-blue-50 text-blue-600' : 'bg-blue-500/10 text-blue-400') : (theme === 'light' ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}" data-db="${db}">
                                    <span class="material-symbols-outlined text-[12px] opacity-70">database</span>
                                    ${db}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}
                </div>
                ` : ''}

                <button id="capture-btn" class="${classes.button}">
                    <span class="material-symbols-outlined text-[16px]">camera_alt</span> Capture Snapshot
                </button>
            </div>
        `;

        const captureBtn = header.querySelector('#capture-btn');
        if (captureBtn) captureBtn.addEventListener('click', captureSnapshot);

        const dbSelectBtn = header.querySelector('#db-select-btn');
        if (dbSelectBtn) {
            dbSelectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                isDbSelectorOpen = !isDbSelectorOpen;
                render();
            });
        }

        header.querySelectorAll('.db-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedDatabase = e.currentTarget.dataset.db;
                isDbSelectorOpen = false;
                loadSnapshots();
            });
        });

        // Close dropdown on click outside
        const closeDropdown = () => {
            if (isDbSelectorOpen) {
                isDbSelectorOpen = false;
                render();
            }
        };
        // We need to be careful not to add multiple listeners if re-rendering often, 
        // but here render replaces the whole subContainer content, so listeners inside are gone.
        // The window listener needs to be managed carefully.
        // For simplicity, we can rely on a backdrop or just this simple check if it doesn't leak.
        // A better pattern is to attach to container and check target, but let's just use a one-time click handler on window if open.
        if (isDbSelectorOpen) {
            setTimeout(() => window.addEventListener('click', closeDropdown, { once: true }), 0);
        }

        header.ondblclick = async (e) => {
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) return;
            const appWindow = getCurrentWindow();
            await appWindow.toggleMaximize();
        };

        subContainer.appendChild(header);

        // Content Area
        const content = document.createElement('div');
        content.className = classes.content;
        subContainer.appendChild(content);

        // Timeline
        const timeline = SchemaTimeline({
            snapshots,
            selectedSnapshotId: selectedSnapshot?.id,
            onSelectSnapshot: (snap) => selectSnapshot(snap),
            qualityScores
        });
        content.appendChild(timeline);

        // Main Panel
        const mainPanel = document.createElement('div');
        mainPanel.className = classes.mainPanel;

        if (currentDiff) {
            const tabs = document.createElement('div');
            tabs.className = classes.tabBar;
            tabs.innerHTML = `
                <button data-tab="diff" class="${classes.tabBtn(activeTab === 'diff', 'diff')}">
                    CHANGES & MIGRATION
                </button>
                <button data-tab="story" class="${classes.tabBtn(activeTab === 'story', 'story')}">
                    <span class="material-symbols-outlined text-[14px]">auto_stories</span>
                    CHRONICLE STORY
                </button>
            `;
            tabs.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    activeTab = btn.dataset.tab;
                    render();
                });
            });
            mainPanel.appendChild(tabs);
        }

        const viewContainer = document.createElement('div');
        viewContainer.className = 'flex-1 overflow-hidden relative';

        if (activeTab === 'story') {
            viewContainer.appendChild(StoryPanel({ story: currentStory, isLoading: isStoryLoading }));
        } else {
            viewContainer.appendChild(SchemaDiffViewer({
                diff: currentDiff,
                migrationScript: currentMigration,
                breakingChanges: currentBreakingChanges,
                connectionId: activeConnection?.id,
                dbType: activeConnection?.dbType || activeConnection?.db_type || 'mysql',
                baseSnapshotId: comparisonBaseSnapshotId,
                targetSnapshotId: comparisonTargetSnapshotId
            }));
        }

        mainPanel.appendChild(viewContainer);
        content.appendChild(mainPanel);
    };

    // --- Theme Listener ---
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    // --- Init ---
    const connStr = localStorage.getItem('activeConnection');
    if (connStr) {
        activeConnection = JSON.parse(connStr);
        if (!activeConnection.dbType) activeConnection.dbType = 'mysql';
        loadSnapshots();
    } else {
        render();
    }

    return container;
}
