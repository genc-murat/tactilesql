import { invoke } from '@tauri-apps/api/core';
import { QualityAnalyzerApi } from '../../../api/qualityAnalyzer.js';
import { ThemeManager } from '../../../utils/ThemeManager.js';
import { AiService } from '../../../utils/AiService.js';
import { toastError, toastSuccess } from '../../../utils/Toast.js';
import { CustomDropdown } from '../../UI/CustomDropdown.js';
import { showQueryAnalyzerModal } from '../../UI/QueryAnalyzerModal.js';
import { Dialog } from '../../UI/Dialog.js';
import './QualityDashboard.css';

export function QualityDashboard() {
    let theme = ThemeManager.getCurrentTheme();

    // Theme helpers
    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic';
        const isEmber = t === 'ember';
        const isAurora = t === 'aurora';
        const isNeon = t === 'neon';

        return {
            container: `quality-dashboard flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-[#2E3440]' : (isEmber ? 'bg-[#140c12]' : (isAurora ? 'bg-[#0b1214]' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))))} transition-colors duration-300`,
            header: `px-6 py-4 flex flex-col gap-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-[#3B4252] border-[#4C566A]' : (isEmber ? 'bg-[#1d141c] border-[#2c1c27]' : (isAurora ? 'bg-[#0f1a1d] border-[#1b2e33]' : (isNeon ? 'bg-neon-panel border-neon-border/30' : 'bg-[#13161b] border-white/10')))))}`,
            content: `flex-1 overflow-y-auto custom-scrollbar p-6 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-[#2E3440]' : (isEmber ? 'bg-[#140c12]' : (isAurora ? 'bg-[#0b1214]' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))))}`,
            card: `rounded-xl border shadow-sm p-5 ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-sm shadow-[#ea9d34]/5' : (isOceanic ? 'bg-[#3B4252] border-[#4C566A]' : (isEmber ? 'bg-[#1d141c] border-[#2c1c27]' : (isAurora ? 'bg-[#0f1a1d] border-[#1b2e33]' : (isNeon ? 'bg-neon-panel border-neon-border/40' : 'bg-[#13161b] border-white/10')))))}`,
            text: {
                primary: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white')),
                secondary: isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')),
                label: isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/50' : 'text-gray-400')),
                accent: isDawn ? 'text-[#ea9d34]' : (isEmber ? 'text-purple-400' : (isAurora ? 'text-cyan-400' : (isNeon ? 'text-cyan-400' : 'text-mysql-teal')))
            },
            input: `w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-all ${isLight
                ? 'bg-white border-gray-300 text-gray-900 focus:border-mysql-teal focus:ring-mysql-teal/20'
                : (isDawn
                    ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34] focus:ring-[#ea9d34]/20'
                    : (isNeon
                        ? 'bg-neon-bg border-neon-border/40 text-neon-text focus:border-cyan-400 focus:ring-cyan-400/20'
                        : 'bg-black/20 border-white/10 text-white focus:border-mysql-teal focus:ring-mysql-teal/20'))
                }`,
            tabBtn: (active) => {
                let accentColor = 'text-mysql-teal';
                if (isDawn) accentColor = 'text-[#ea9d34]';
                if (isEmber) accentColor = 'text-purple-400';
                if (isAurora) accentColor = 'text-cyan-400';
                if (t === 'neon') accentColor = 'text-cyan-400';

                return `relative px-1 py-3 text-sm font-medium transition-colors ${active
                    ? accentColor
                    : (isLight ? 'text-gray-500 hover:text-gray-700' : (isDawn ? 'text-[#9893a5] hover:text-[#575279]' : (t === 'neon' ? 'text-neon-text/40 hover:text-neon-text' : 'text-gray-400 hover:text-white')))
                    } ${active ? 'border-b-2' : ''}`;
            },
            tabBorder: isDawn ? 'border-[#ea9d34]' : (isEmber ? 'border-purple-500' : (isAurora ? 'border-cyan-500' : (isNeon ? 'border-cyan-400' : 'border-mysql-teal')))
        };
    };

    let classes = getClasses(theme);
    const container = document.createElement('div');
    container.className = classes.container;

    // State
    let state = {
        connections: [],
        selectedConnectionId: null,
        databases: [],
        selectedDatabase: null,
        tables: [],
        selectedTable: null,
        selectedSampleRate: null,

        currentReport: null,
        trends: [],
        rules: [],

        activeTab: 'overview',
        isLoading: false,
        error: null,
        activeDbType: 'mysql',

        aiAnalysis: '',
        aiError: null,
        isAiLoading: false,
        aiProvider: null,
        aiModel: null,
        aiReportKey: null
    };

    // Dropdown instances
    let dropdowns = {
        connection: null,
        database: null,
        table: null,
        sample: null
    };

    const resetAiState = () => {
        state.aiAnalysis = '';
        state.aiError = null;
        state.isAiLoading = false;
        state.aiProvider = null;
        state.aiModel = null;
        state.aiReportKey = null;
    };

    const getAiSettings = () => {
        const storedProvider = localStorage.getItem('ai_provider') || 'openai';
        const provider = ['openai', 'gemini', 'anthropic', 'deepseek', 'groq', 'mistral', 'local'].includes(storedProvider)
            ? storedProvider
            : 'openai';

        const keyStorageKeys = {
            openai: 'openai_api_key',
            gemini: 'gemini_api_key',
            anthropic: 'anthropic_api_key',
            deepseek: 'deepseek_api_key',
            groq: 'groq_api_key',
            mistral: 'mistral_api_key',
            local: 'local_api_key'
        };

        const modelStorageKeys = {
            openai: 'openai_model',
            gemini: 'gemini_model',
            anthropic: 'anthropic_model',
            deepseek: 'deepseek_model',
            groq: 'groq_model',
            mistral: 'mistral_model',
            local: 'local_model'
        };

        const defaultModels = {
            openai: 'gpt-4o',
            gemini: 'gemini-2.5-flash',
            anthropic: 'claude-3-5-sonnet-20241022',
            deepseek: 'deepseek-chat',
            groq: 'llama-3.1-8b-instant',
            mistral: 'mistral-large-latest',
            local: 'llama3'
        };

        const apiKey = localStorage.getItem(keyStorageKeys[provider] || 'openai_api_key') || '';
        const model = localStorage.getItem(modelStorageKeys[provider] || 'openai_model') || defaultModels[provider] || 'gpt-4o';

        return { provider, apiKey, model };
    };

    const getReportKey = (report) => {
        if (!report) return null;
        return [
            report.table_name || '',
            report.schema_name || '',
            report.timestamp || '',
            Number(report.overall_score || 0).toFixed(4),
            report.row_count || 0
        ].join('|');
    };

    const parseReportId = (value) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };

    const getConnectionContext = () => {
        const activeConnection = JSON.parse(localStorage.getItem('activeConnection') || '{}');
        const selectedConnection = state.connections.find((c) => c.id === state.selectedConnectionId);

        if (selectedConnection) {
            return { ...activeConnection, ...selectedConnection, id: state.selectedConnectionId, dbType: selectedConnection.dbType || state.activeDbType };
        }

        if (state.selectedConnectionId) {
            return { ...activeConnection, id: state.selectedConnectionId, dbType: state.activeDbType };
        }

        return activeConnection;
    };

    const loadSavedAiAnalysisForReport = async (report) => {
        const reportKey = getReportKey(report);
        state.aiReportKey = reportKey;
        state.aiAnalysis = '';
        state.aiError = null;
        state.aiProvider = null;
        state.aiModel = null;

        const reportId = parseReportId(report?.id);
        if (!reportId || !state.selectedConnectionId) {
            render();
            return;
        }

        try {
            const savedReport = await QualityAnalyzerApi.getAiReport(state.selectedConnectionId, reportId);
            if (getReportKey(state.currentReport) !== reportKey) return;

            if (savedReport?.analysis_text) {
                state.aiAnalysis = savedReport.analysis_text;
                state.aiProvider = savedReport.provider || null;
                state.aiModel = savedReport.model || null;
            }
        } catch (err) {
            console.error('Failed to load saved quality AI report:', err);
        } finally {
            if (getReportKey(state.currentReport) === reportKey) {
                render();
            }
        }
    };

    // Initialize
    const init = async () => {
        try {
            state.connections = await invoke('load_connections');
            const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || 'null');
            if (activeConfig && activeConfig.id) {
                await selectConnection(activeConfig.id);
            }
        } catch (err) {
            console.error('Init failed:', err);
            state.error = 'Failed to load connections';
        }
        render();
    };

    // Actions
    const selectConnection = async (connId) => {
        state.selectedConnectionId = connId;
        state.selectedDatabase = null;
        state.selectedTable = null;
        state.databases = [];
        state.tables = [];
        state.currentReport = null;
        state.trends = [];
        state.rules = [];
        resetAiState();

        const conn = state.connections.find(c => c.id === connId);
        if (!conn) return;

        state.activeDbType = conn.dbType || 'mysql';

        try {
            await invoke('establish_connection', { config: conn });
            state.databases = await invoke('get_databases');

            if (conn.database && state.databases.includes(conn.database)) {
                await selectDatabase(conn.database);
            } else if (conn.schema && state.databases.includes(conn.schema)) {
                await selectDatabase(conn.schema);
            } else if (state.databases.length > 0) {
                if (state.databases.length === 1) await selectDatabase(state.databases[0]);
            }
        } catch (err) {
            console.error('Connection switch failed:', err);
            state.error = 'Failed to connect: ' + err.toString();
        }
        render();
    };

    const selectDatabase = async (dbName) => {
        state.selectedDatabase = dbName;
        state.selectedTable = null;
        state.tables = [];
        state.currentReport = null;
        state.trends = [];
        state.rules = [];
        resetAiState();

        try {
            state.tables = await invoke('get_tables', { database: dbName });
        } catch (err) {
            console.error('Fetch tables failed:', err);
            state.error = 'Failed to fetch tables';
        }
        render();
    };

    const selectTable = async (tableName) => {
        state.selectedTable = tableName;
        state.currentReport = null;
        state.activeTab = 'overview';
        state.trends = [];
        state.rules = [];
        resetAiState();

        if (tableName) {
            fetchTrends(tableName);
            fetchRules(tableName);
        }
        render();
    };

    const fetchTrends = async (tableName) => {
        if (!state.selectedConnectionId) return;
        try {
            const reports = await QualityAnalyzerApi.getReports(state.selectedConnectionId);
            state.trends = reports
                .filter(r => r.table_name === tableName && (!r.schema_name || r.schema_name === state.selectedDatabase))
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            if (state.trends.length > 0 && !state.currentReport) {
                state.currentReport = state.trends[state.trends.length - 1];
                await loadSavedAiAnalysisForReport(state.currentReport);
                return;
            }
            render();
        } catch (err) {
            console.warn("Failed to fetch trends", err);
        }
    };

    const fetchRules = async (tableName) => {
        if (!state.selectedConnectionId || !tableName || !state.selectedDatabase) return;
        try {
            state.rules = await QualityAnalyzerApi.getRules(state.selectedConnectionId, tableName, state.selectedDatabase);
            render();
        } catch (err) {
            console.warn("Failed to fetch rules", err);
        }
    };

    const runAnalysis = async () => {
        if (!state.selectedConnectionId || !state.selectedTable || !state.selectedDatabase) return;

        state.isLoading = true;
        resetAiState();
        render();

        try {
            const report = await QualityAnalyzerApi.runAnalysis(
                state.selectedConnectionId, 
                state.selectedTable, 
                state.selectedDatabase,
                state.selectedSampleRate
            );
            state.currentReport = report;
            state.activeTab = 'overview';

            await fetchTrends(state.selectedTable);
            await loadSavedAiAnalysisForReport(state.currentReport);

        } catch (err) {
            console.error(err);
            state.error = err.toString();
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const runAiQualityAnalysis = async () => {
        if (!state.currentReport || state.isAiLoading) return;

        const reportKey = getReportKey(state.currentReport);
        const qualityReportId = parseReportId(state.currentReport.id);
        const { provider, apiKey, model } = getAiSettings();

        if (provider !== 'local' && !apiKey) {
            state.aiReportKey = reportKey;
            state.aiError = `Missing ${provider.toUpperCase()} API key. Configure it in Settings > AI Assistant.`;
            toastError(state.aiError);
            render();
            return;
        }

        state.isAiLoading = true;
        state.aiError = null;
        state.aiAnalysis = '';
        state.aiProvider = provider;
        state.aiModel = model;
        state.aiReportKey = reportKey;
        render();

        try {
            const analysis = await AiService.analyzeQualityReport(provider, apiKey, model, {
                connection: getConnectionContext(),
                database: state.selectedDatabase,
                table: state.selectedTable,
                report: state.currentReport,
                trends: state.trends
            });

            if (getReportKey(state.currentReport) !== reportKey) return;
            state.aiAnalysis = analysis;
            state.aiError = null;
            state.aiReportKey = reportKey;

            if (qualityReportId && state.selectedConnectionId) {
                try {
                    const saved = await QualityAnalyzerApi.saveAiReport({
                        connectionId: state.selectedConnectionId,
                        qualityReportId,
                        tableName: state.currentReport.table_name || state.selectedTable || '',
                        schemaName: state.currentReport.schema_name || state.selectedDatabase || null,
                        provider,
                        model,
                        analysisText: analysis
                    });

                    if (getReportKey(state.currentReport) !== reportKey) return;
                    state.aiAnalysis = saved?.analysis_text || state.aiAnalysis;
                    state.aiProvider = saved?.provider || provider;
                    state.aiModel = saved?.model || model;
                    toastSuccess('AI quality analysis completed and saved.');
                } catch (saveError) {
                    console.error('Failed to save quality AI report:', saveError);
                    toastError(`AI analysis generated but could not be saved: ${saveError?.message || saveError}`);
                }
            } else {
                toastSuccess('AI quality analysis completed.');
            }
        } catch (error) {
            if (getReportKey(state.currentReport) !== reportKey) return;
            state.aiAnalysis = '';
            state.aiError = error?.message || 'Unknown AI analysis error';
            toastError(`AI quality analysis failed: ${state.aiError}`);
        } finally {
            if (getReportKey(state.currentReport) !== reportKey) return;
            state.isAiLoading = false;
            render();
        }
    };

    const switchTab = (tab) => {
        state.activeTab = tab;
        render();
    };

    const exportReport = (format) => {
        if (!state.currentReport) return;

        const timestamp = new Date(state.currentReport.timestamp).toISOString().replace(/[:.]/g, '-');
        const filename = `quality_report_${state.currentReport.table_name}_${timestamp}`;

        if (format === 'json') {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
                report: state.currentReport,
                aiAnalysis: state.aiAnalysis
            }, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", filename + ".json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            toastSuccess('Report exported as JSON');
        } else if (format === 'pdf') {
            window.print();
        }
    };

    const applyRemediationFix = async (sql, title) => {
        const confirmed = await Dialog.confirm(`Apply this remediation fix?\n\nISSUE: ${title}\n\nSQL:\n${sql}`, 'Remediation Approval');
        if (!confirmed) return;

        try {
            await invoke('execute_query', { query: sql });
            toastSuccess('Remediation applied successfully.');
            runAnalysis();
        } catch (error) {
            Dialog.alert(`Failed to apply fix: ${error}`, 'Execution Error');
        }
    };

    const addRule = async () => {
        const name = await Dialog.prompt('Rule Name (e.g., "Valid Price")', 'Add Custom Rule');
        if (!name) return;
        const assertion = await Dialog.prompt('SQL Assertion (e.g., "price > 0")', 'Add Custom Rule');
        if (!assertion) return;

        try {
            await QualityAnalyzerApi.saveRule({
                connection_id: state.selectedConnectionId,
                table_name: state.selectedTable,
                schema_name: state.selectedDatabase,
                rule_name: name,
                sql_assertion: assertion,
                is_active: true,
                created_at: new Date().toISOString()
            });
            toastSuccess('Rule added successfully.');
            fetchRules(state.selectedTable);
        } catch (err) {
            toastError('Failed to add rule: ' + err);
        }
    };

    const deleteRule = async (id) => {
        const confirmed = await Dialog.confirm('Delete this rule?', 'Confirm Delete');
        if (!confirmed) return;

        try {
            await QualityAnalyzerApi.deleteRule(id);
            toastSuccess('Rule deleted.');
            fetchRules(state.selectedTable);
        } catch (err) {
            toastError('Failed to delete rule: ' + err);
        }
    };

    // Render Logic
    const render = () => {
        container.innerHTML = '';
        container.className = classes.container;

        const header = document.createElement('div');
        header.className = classes.header;

        const controls = document.createElement('div');
        controls.className = 'flex items-end gap-3 flex-wrap';

        const createDropdown = (label, id, items, value, onSelect, disabled = false) => {
            const div = document.createElement('div');
            div.className = 'flex flex-col gap-1.5 min-w-[200px] flex-1';

            const labelEl = document.createElement('label');
            labelEl.className = `text-[10px] font-bold uppercase tracking-wider ${classes.text.label}`;
            labelEl.textContent = label;
            div.appendChild(labelEl);

            const dropdownContainer = document.createElement('div');
            dropdownContainer.id = id;
            if (disabled) {
                dropdownContainer.style.opacity = '0.5';
                dropdownContainer.style.pointerEvents = 'none';
            }
            div.appendChild(dropdownContainer);

            const dropdown = new CustomDropdown({
                items,
                value,
                placeholder: `Select ${label}...`,
                className: 'w-full',
                onSelect
            });

            dropdownContainer.appendChild(dropdown.getElement());

            return { div, dropdown };
        };

        const connItems = state.connections.map(c => ({ value: c.id, label: c.name, icon: 'database' }));
        const connDropdown = createDropdown('Connection', 'conn-dropdown', connItems, state.selectedConnectionId, (val) => selectConnection(val));
        controls.appendChild(connDropdown.div);
        dropdowns.connection = connDropdown.dropdown;

        const dbItems = state.databases.map(db => ({ value: db, label: db, icon: 'storage' }));
        const dbDropdown = createDropdown(state.activeDbType === 'postgresql' ? 'Schema' : 'Database', 'db-dropdown', dbItems, state.selectedDatabase, (val) => selectDatabase(val), !state.selectedConnectionId);
        controls.appendChild(dbDropdown.div);
        dropdowns.database = dbDropdown.dropdown;

        const tableItems = state.tables.map(t => ({ value: t, label: t, icon: 'table' }));
        const tableDropdown = createDropdown('Table', 'table-dropdown', tableItems, state.selectedTable, (val) => selectTable(val), !state.selectedDatabase);
        controls.appendChild(tableDropdown.div);
        dropdowns.table = tableDropdown.dropdown;

        const sampleItems = [
            { value: null, label: 'Full Scan', icon: 'auto_awesome_motion' },
            { value: 10, label: 'Sample 10%', icon: 'filter_list' },
            { value: 1, label: 'Sample 1%', icon: 'filter_list' },
        ];
        const sampleDropdown = createDropdown('Sample Rate', 'sample-dropdown', sampleItems, state.selectedSampleRate, (val) => {
            state.selectedSampleRate = val;
            render();
        }, !state.selectedTable);
        controls.appendChild(sampleDropdown.div);
        dropdowns.sample = sampleDropdown.dropdown;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'pb-[1px] flex gap-2';
        const runBtn = document.createElement('button');
        runBtn.id = 'run-btn';
        runBtn.className = `px-5 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wide transition-all ${(!state.selectedTable || state.isLoading)
            ? 'opacity-50 cursor-not-allowed bg-gray-300 text-gray-500'
            : (theme === 'dawn' ? 'bg-[#ea9d34] text-[#fffaf3] hover:bg-[#d7821a] shadow-lg shadow-[#ea9d34]/20' : (theme === 'neon' ? 'bg-cyan-400 text-black hover:bg-cyan-300 shadow-[0_0_15px_rgba(0,243,255,0.4)]' : 'bg-mysql-teal text-white hover:bg-mysql-cyan shadow-lg shadow-mysql-teal/20'))
            }`;
        runBtn.innerHTML = state.isLoading
            ? '<span class="material-symbols-outlined text-sm animate-spin align-bottom mr-1">sync</span> Analyzing...'
            : '<span class="material-symbols-outlined text-sm align-bottom mr-1">play_arrow</span> Run Analysis';
        runBtn.disabled = !state.selectedTable || state.isLoading;
        runBtn.onclick = runAnalysis;
        btnContainer.appendChild(runBtn);

        if (state.currentReport) {
            const exportBtn = document.createElement('div');
            exportBtn.className = 'relative group';
            exportBtn.innerHTML = `
                <button class="px-3 py-2.5 rounded-lg border ${theme === 'light' ? 'border-gray-200 text-gray-600 hover:bg-gray-50' : 'border-white/10 text-gray-400 hover:bg-white/5'} transition-all flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm">download</span>
                    <span class="text-xs font-bold uppercase">Export</span>
                </button>
                <div class="absolute right-0 top-full mt-1 hidden group-hover:block z-50 min-w-[120px] rounded-lg shadow-xl border ${theme === 'light' ? 'bg-white border-gray-200' : 'bg-[#1a1d23] border-white/10'} overflow-hidden">
                    <button class="w-full px-4 py-2 text-left text-xs font-bold hover:bg-blue-500/10 hover:text-blue-400 transition-all border-b border-white/5 flex items-center gap-2" id="export-json">
                        <span class="material-symbols-outlined text-sm">data_object</span> JSON
                    </button>
                    <button class="w-full px-4 py-2 text-left text-xs font-bold hover:bg-blue-500/10 hover:text-blue-400 transition-all flex items-center gap-2" id="export-pdf">
                        <span class="material-symbols-outlined text-sm">picture_as_pdf</span> PDF / Print
                    </button>
                </div>
            `;
            exportBtn.querySelector('#export-json').onclick = () => exportReport('json');
            exportBtn.querySelector('#export-pdf').onclick = () => exportReport('pdf');
            btnContainer.appendChild(exportBtn);
        }

        controls.appendChild(btnContainer);
        header.appendChild(controls);

        if (state.selectedTable) {
            const tabs = document.createElement('div');
            tabs.className = `flex gap-6 mt-2 relative ${classes.text.secondary}`;

            const createTab = (id, label) => {
                const isActive = state.activeTab === id;
                const btn = document.createElement('button');
                btn.className = classes.tabBtn(isActive);
                if (isActive) btn.style.borderColor = theme === 'dawn' ? '#ea9d34' : (theme === 'neon' ? '#00f3ff' : '#00c8ff');
                btn.textContent = label;
                btn.onclick = () => switchTab(id);
                return btn;
            };

            tabs.appendChild(createTab('overview', 'Overview'));
            tabs.appendChild(createTab('trends', `Trends (${state.trends.length})`));
            tabs.appendChild(createTab('rules', `Rules (${state.rules.length})`));

            header.appendChild(tabs);
        }

        container.appendChild(header);

        const contentArea = document.createElement('div');
        contentArea.className = classes.content;
        container.appendChild(contentArea);

        if (state.isLoading) {
            contentArea.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center gap-3 ${classes.text.secondary}">
                    <span class="material-symbols-outlined text-4xl animate-spin ${classes.text.accent}">sync</span> 
                    <p class="animate-pulse">Analyzing data quality...</p>
                </div>
            `;
            return;
        }

        if (state.error) {
            contentArea.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center gap-3 text-red-400">
                    <span class="material-symbols-outlined text-4xl">error</span> 
                    <p>${state.error}</p>
                </div>
            `;
            state.error = null;
            return;
        }

        if (state.activeTab === 'overview') {
            if (state.currentReport) {
                renderOverview(contentArea, state.currentReport);
            } else {
                renderEmptyState(contentArea);
            }
        } else if (state.activeTab === 'trends') {
            renderTrends(contentArea);
        } else if (state.activeTab === 'rules') {
            renderRules(contentArea);
        }
    };

    function renderEmptyState(parent) {
        parent.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center gap-4 opacity-50 ${classes.text.secondary}">
                <span class="material-symbols-outlined text-6xl">fact_check</span>
                <div class="text-center">
                    <h3 class="text-lg font-bold ${classes.text.primary}">Ready to Analyze</h3>
                    <p class="text-sm">Select a table above to run a comprehensive data quality assessment.</p>
                </div>
            </div>
         `;
    }

    function renderOverview(parent, report) {
        const scoreColor = getScoreColor(report.overall_score);

        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-[300px_1fr] gap-6 max-w-7xl mx-auto';

        const getFreshnessInfo = (lastUpdated) => {
            if (!lastUpdated) return null;
            const lu = new Date(lastUpdated);
            const now = new Date();
            const diffDays = Math.floor((now - lu) / (1000 * 60 * 60 * 24));
            
            let color = 'text-green-400';
            let label = 'Fresh';
            if (diffDays > 30) {
                color = 'text-red-400';
                label = 'Stale';
            } else if (diffDays > 7) {
                color = 'text-amber-400';
                label = 'Old';
            }

            return { label, color, diffDays, dateStr: lu.toLocaleDateString() };
        };

        const freshness = getFreshnessInfo(report.last_updated);

        const scoreCard = document.createElement('div');
        scoreCard.className = `${classes.card} flex flex-col items-center justify-center row-span-2`;
        scoreCard.innerHTML = `
            <h3 class="text-sm font-bold uppercase tracking-wider ${classes.text.secondary} mb-6">Overall Quality Score</h3>
            <div class="w-36 h-36 rounded-full border-8 flex flex-col items-center justify-center mb-6 transition-all" style="border-color: ${scoreColor}20">
                <span class="text-5xl font-black" style="color: ${scoreColor}">${report.overall_score.toFixed(0)}</span>
                <span class="text-xs font-bold uppercase ${classes.text.secondary} mt-1">/ 100</span>
            </div>
            <div class="w-full flex justify-between pt-4 border-t ${theme === 'light' ? 'border-gray-100' : 'border-white/5'} ${classes.text.secondary} text-xs font-mono">
                <div class="flex flex-col items-center">
                    <span class="${classes.text.primary} font-bold text-sm">${report.row_count.toLocaleString()}</span>
                    <span>ROWS</span>
                </div>
                <div class="flex flex-col items-center">
                    <span class="${report.issues.length > 0 ? 'text-red-400' : 'text-green-400'} font-bold text-sm">${report.issues.length}</span>
                    <span>ISSUES</span>
                </div>
            </div>
            ${freshness ? `
            <div class="w-full flex flex-col items-center mt-4 pt-4 border-t ${theme === 'light' ? 'border-gray-100' : 'border-white/5'}">
                <span class="text-[9px] font-bold opacity-50 uppercase mb-1">Data Freshness</span>
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold ${freshness.color}">${freshness.label}</span>
                    <span class="text-[10px] ${classes.text.secondary}">• ${freshness.diffDays}d ago</span>
                </div>
                <span class="text-[9px] font-mono opacity-40 mt-1">${freshness.dateStr}</span>
            </div>
            ` : ''}
             <div class="text-[10px] ${classes.text.secondary} mt-4 text-center">
                Analyzed ${new Date(report.timestamp).toLocaleString()}
            </div>
        `;
        grid.appendChild(scoreCard);

        const issuesCard = document.createElement('div');
        issuesCard.className = `${classes.card} flex flex-col`;
        issuesCard.innerHTML = `<h3 class="text-sm font-bold uppercase tracking-wider ${classes.text.secondary} mb-4">Top Issues</h3>`;

        if (report.issues.length === 0) {
            issuesCard.innerHTML += `
                <div class="flex-1 flex flex-col items-center justify-center gap-2 text-green-500 py-8">
                    <span class="material-symbols-outlined text-3xl">check_circle</span>
                    <span class="font-medium">No quality issues found</span>
                </div>
            `;
        } else {
            const list = document.createElement('div');
            list.className = 'space-y-3';
            report.issues.slice(0, 10).forEach((issue, idx) => {
                const item = document.createElement('div');
                const severity = formatIssueSeverity(issue.severity).toLowerCase();
                const severityColors = {
                    critical: 'bg-red-500',
                    warning: 'bg-amber-500',
                    info: 'bg-blue-500'
                };
                const color = severityColors[severity] || 'bg-gray-500';

                item.className = `flex items-center justify-between gap-3 pb-3 border-b ${theme === 'light' ? 'border-gray-100' : 'border-white/5'} last:border-0`;
                
                const left = document.createElement('div');
                left.className = 'flex gap-3';
                left.innerHTML = `
                    <div class="mt-1.5 w-2 h-2 rounded-full ${color} shrink-0"></div>
                    <div>
                        <div class="text-sm font-bold ${classes.text.primary}">${formatIssueType(issue.issue_type)}</div>
                        <div class="text-xs ${classes.text.secondary} mt-0.5">${issue.description}</div>
                    </div>
                `;
                item.appendChild(left);

                if (issue.drill_down_query) {
                    const drillBtn = document.createElement('button');
                    drillBtn.className = `shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-bold uppercase transition-all ${theme === 'dawn' ? 'bg-[#ea9d34]/10 text-[#ea9d34] hover:bg-[#ea9d34]/20' : 'bg-mysql-teal/10 text-mysql-teal hover:bg-mysql-teal/20'}`;
                    drillBtn.innerHTML = '<span class="material-symbols-outlined text-sm">visibility</span> Analyze';
                    drillBtn.onclick = () => {
                        const title = `Drill-down: ${formatIssueType(issue.issue_type)} in ${issue.column_name || 'table'}`;
                        showQueryAnalyzerModal(title, issue.drill_down_query, state.selectedConnectionId);
                    };
                    item.appendChild(drillBtn);
                }

                list.appendChild(item);
            });
            issuesCard.appendChild(list);
        }
        grid.appendChild(issuesCard);

        const aiReportKey = getReportKey(report);
        const hasAiAnalysisForReport = Boolean(state.aiAnalysis && state.aiReportKey === aiReportKey);
        const hasAiErrorForReport = Boolean(state.aiError && state.aiReportKey === aiReportKey);
        const isAiLoadingForReport = state.isAiLoading && state.aiReportKey === aiReportKey;

        const aiCard = document.createElement('div');
        aiCard.className = `${classes.card} flex flex-col`;

        const aiHeader = document.createElement('div');
        aiHeader.className = 'flex items-center justify-between gap-3 mb-3';
        aiHeader.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-sm ${theme === 'dawn' ? 'text-[#ea9d34]' : 'text-mysql-teal'}">auto_awesome</span>
                <h3 class="text-sm font-bold uppercase tracking-wider ${classes.text.secondary}">AI Quality Insights</h3>
            </div>
            <button id="quality-ai-run-btn" class="px-3 py-1.5 rounded text-xs font-bold transition-all ${isAiLoadingForReport
                ? 'opacity-60 cursor-not-allowed bg-gray-300 text-gray-600'
                : (theme === 'dawn'
                    ? 'bg-[#ea9d34]/10 text-[#ea9d34] hover:bg-[#ea9d34]/20'
                    : (theme === 'neon'
                        ? 'bg-neon-accent/20 text-neon-accent border border-neon-accent/30 hover:bg-neon-accent/30'
                        : 'bg-mysql-teal/10 text-mysql-teal hover:bg-mysql-teal/20'))
            }" ${isAiLoadingForReport ? 'disabled' : ''}>
                ${isAiLoadingForReport ? 'Analyzing...' : (hasAiAnalysisForReport ? 'Re-Analyze' : 'Analyze with AI')}
            </button>
        `;
        aiCard.appendChild(aiHeader);

        if (state.aiProvider && state.aiModel && (hasAiAnalysisForReport || hasAiErrorForReport || isAiLoadingForReport)) {
            const meta = document.createElement('div');
            meta.className = `text-[10px] ${classes.text.secondary} mb-3`;
            meta.textContent = `Provider: ${state.aiProvider} • Model: ${state.aiModel}`;
            aiCard.appendChild(meta);
        }

        if (isAiLoadingForReport) {
            const loading = document.createElement('div');
            loading.className = `flex items-center gap-2 text-xs ${classes.text.secondary} py-4`;
            loading.innerHTML = `
                <span class="material-symbols-outlined text-sm animate-spin ${theme === 'dawn' ? 'text-[#ea9d34]' : 'text-mysql-teal'}">progress_activity</span>
                AI is analyzing quality risks and remediation steps...
            `;
            aiCard.appendChild(loading);
        } else if (hasAiErrorForReport) {
            const err = document.createElement('div');
            err.className = 'px-3 py-2 rounded border border-red-500/20 bg-red-500/10 text-red-500 text-xs';
            err.textContent = state.aiError;
            aiCard.appendChild(err);
        } else if (hasAiAnalysisForReport) {
            const analysisWrap = document.createElement('div');
            analysisWrap.className = `rounded-lg border ${theme === 'light'
                ? 'bg-gray-50 border-gray-200'
                : (theme === 'dawn'
                    ? 'bg-[#faf4ed] border-[#f2e9e1]'
                    : 'bg-black/20 border-white/10')
                }`;

            const toolbar = document.createElement('div');
            toolbar.className = `flex items-center justify-between px-3 py-2 border-b ${theme === 'light' ? 'border-gray-200' : (theme === 'dawn' ? 'border-[#f2e9e1]' : 'border-white/10')}`;
            toolbar.innerHTML = `
                <span class="text-[10px] font-bold uppercase tracking-wider ${classes.text.secondary}">AI Report</span>
                <button id="quality-ai-copy-btn" class="px-2 py-1 rounded text-[10px] font-bold ${theme === 'light'
                    ? 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                    : (theme === 'dawn'
                        ? 'bg-[#fffaf3] border border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]'
                        : 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10')
                }">
                    Copy
                </button>
            `;
            analysisWrap.appendChild(toolbar);

            const pre = document.createElement('pre');
            pre.className = `p-3 text-[11px] leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto custom-scrollbar ${classes.text.primary} font-mono`;
            pre.textContent = state.aiAnalysis;
            analysisWrap.appendChild(pre);

            aiCard.appendChild(analysisWrap);

            const remediationSqls = parseRemediationSql(state.aiAnalysis);
            if (remediationSqls.length > 0) {
                const remediationTitle = document.createElement('div');
                remediationTitle.className = `text-[10px] font-bold uppercase tracking-widest ${classes.text.accent} mt-4 mb-2`;
                remediationTitle.textContent = 'Auto-Fix Recommendations';
                aiCard.appendChild(remediationTitle);

                remediationSqls.forEach(fix => {
                    const fixBox = document.createElement('div');
                    fixBox.className = `p-3 rounded-lg border ${theme === 'dawn' ? 'bg-[#ea9d34]/5 border-[#ea9d34]/20' : 'bg-mysql-teal/5 border-mysql-teal/20'} mb-2`;
                    fixBox.innerHTML = `
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-[10px] font-bold ${classes.text.primary}">${fix.title}</span>
                            <button class="apply-fix-btn px-2 py-1 rounded bg-red-500 text-white text-[9px] font-bold uppercase hover:bg-red-600 transition-all shadow-md">
                                Apply Fix
                            </button>
                        </div>
                        <pre class="text-[9px] font-mono opacity-70 whitespace-pre-wrap">${fix.sql}</pre>
                    `;
                    fixBox.querySelector('.apply-fix-btn').onclick = () => applyRemediationFix(fix.sql, fix.title);
                    aiCard.appendChild(fixBox);
                });
            }
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = `text-xs ${classes.text.secondary} py-4`;
            placeholder.textContent = 'Run AI analysis to get risk summary, root-cause hypotheses, remediation plan, and validation queries.';
            aiCard.appendChild(placeholder);
        }

        aiHeader.querySelector('#quality-ai-run-btn')?.addEventListener('click', runAiQualityAnalysis);
        aiCard.querySelector('#quality-ai-copy-btn')?.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(state.aiAnalysis || '');
                toastSuccess('AI analysis copied to clipboard.');
            } catch (error) {
                toastError(`Copy failed: ${error?.message || error}`);
            }
        });
        grid.appendChild(aiCard);

        const metricsCard = document.createElement('div');
        metricsCard.className = `${classes.card} col-span-2 overflow-hidden`;
        metricsCard.innerHTML = `<h3 class="text-sm font-bold uppercase tracking-wider ${classes.text.secondary} mb-4">Column Metrics</h3>`;

        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'overflow-x-auto';

        const table = document.createElement('table');
        table.className = 'w-full text-left border-collapse';

        const thClass = `py-2 text-[10px] font-bold uppercase tracking-wider ${classes.text.secondary} border-b-2 ${theme === 'light' ? 'border-gray-100' : 'border-white/5'}`;
        const tdClass = `py-3 border-b ${theme === 'light' ? 'border-gray-100' : 'border-white/5'} ${classes.text.primary} text-sm`;

        table.innerHTML = `
            <thead>
                <tr>
                    <th class="${thClass}">Column</th>
                    <th class="${thClass}">NULLs (%)</th>
                    <th class="${thClass}">Distinct (%)</th>
                    <th class="${thClass}">Top Values / Patterns</th>
                    <th class="${thClass}">Stats</th>
                </tr>
            </thead>
            <tbody>
                ${report.column_metrics.map(m => `
                    <tr>
                        <td class="${tdClass} font-mono font-bold">${m.column_name}</td>
                        <td class="${tdClass}">
                            <div class="flex items-center gap-2">
                                <div class="w-16 h-1.5 rounded-full ${theme === 'light' ? 'bg-gray-100' : 'bg-white/10'} overflow-hidden">
                                    <div class="h-full bg-red-400" style="width: ${Math.min(100, m.null_percentage)}%"></div>
                                </div>
                                <span class="text-xs tabular-nums">${m.null_percentage.toFixed(1)}%</span>
                            </div>
                        </td>
                        <td class="${tdClass}">
                            <div class="flex items-center gap-2">
                                <div class="w-16 h-1.5 rounded-full ${theme === 'light' ? 'bg-gray-100' : 'bg-white/10'} overflow-hidden">
                                     <div class="h-full bg-blue-400" style="width: ${Math.min(100, m.distinct_percentage)}%"></div>
                                </div>
                                <span class="text-xs tabular-nums">${m.distinct_percentage.toFixed(1)}%</span>
                            </div>
                        </td>
                        <td class="${tdClass}">
                            ${renderTopValuesAndPatterns(m)}
                        </td>
                        <td class="${tdClass} text-xs ${classes.text.secondary}">
                           ${renderStats(m)}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        tableWrapper.appendChild(table);
        metricsCard.appendChild(tableWrapper);
        grid.appendChild(metricsCard);

        if (report.custom_rule_results && report.custom_rule_results.length > 0) {
            const rulesCard = document.createElement('div');
            rulesCard.className = `${classes.card} col-span-2`;
            rulesCard.innerHTML = `
                <h3 class="text-sm font-bold uppercase tracking-wider ${classes.text.secondary} mb-4">Custom Rule Results</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    ${report.custom_rule_results.map(r => `
                        <div class="p-3 rounded-lg border ${theme === 'light' ? 'bg-gray-50 border-gray-100' : 'bg-black/20 border-white/5'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-xs font-bold ${classes.text.primary}">${r.rule_name}</span>
                                <span class="text-[10px] font-bold ${r.failure_percentage > 0 ? 'text-red-400' : 'text-green-400'} uppercase">
                                    ${r.failure_percentage > 0 ? 'Failed' : 'Passed'}
                                </span>
                            </div>
                            <div class="text-[10px] font-mono opacity-50 mb-3 truncate" title="${r.sql_assertion}">${r.sql_assertion}</div>
                            <div class="flex items-center gap-2">
                                <div class="flex-1 h-1 rounded-full ${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'} overflow-hidden">
                                    <div class="h-full bg-red-400" style="width: ${r.failure_percentage}%"></div>
                                </div>
                                <span class="text-[10px] font-mono ${classes.text.secondary}">${r.failure_percentage.toFixed(1)}% fail</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
            grid.appendChild(rulesCard);
        }

        parent.appendChild(grid);
    }

    function renderRules(parent) {
        const wrap = document.createElement('div');
        wrap.className = 'max-w-4xl mx-auto space-y-6';

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';
        header.innerHTML = `
            <div>
                <h3 class="text-lg font-bold ${classes.text.primary}">Custom Quality Rules</h3>
                <p class="text-xs ${classes.text.secondary}">Define SQL assertions to validate your business rules.</p>
            </div>
            <button id="add-rule-btn" class="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${theme === 'dawn' ? 'bg-[#ea9d34] text-white hover:bg-[#d7821a]' : (theme === 'neon' ? 'bg-cyan-400 text-black hover:bg-cyan-300' : 'bg-mysql-teal text-white hover:bg-mysql-cyan')} shadow-md flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">add</span> Add Rule
            </button>
        `;
        header.querySelector('#add-rule-btn').onclick = addRule;
        wrap.appendChild(header);

        if (state.rules.length === 0) {
            const empty = document.createElement('div');
            empty.className = `${classes.card} py-12 flex flex-col items-center justify-center opacity-50`;
            empty.innerHTML = `
                <span class="material-symbols-outlined text-5xl mb-3">rule</span>
                <p class="text-sm">No custom rules defined for this table.</p>
            `;
            wrap.appendChild(empty);
        } else {
            const list = document.createElement('div');
            list.className = 'grid grid-cols-1 gap-4';
            state.rules.forEach(rule => {
                const card = document.createElement('div');
                card.className = `${classes.card} flex items-center justify-between group`;
                card.innerHTML = `
                    <div class="flex-1">
                        <div class="flex items-center gap-3">
                            <span class="text-sm font-bold ${classes.text.primary}">${rule.rule_name}</span>
                            <span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${rule.is_active ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'}">
                                ${rule.is_active ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                        <div class="mt-1 text-xs font-mono opacity-60 overflow-hidden text-ellipsis">${rule.sql_assertion}</div>
                    </div>
                    <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="delete-rule-btn p-2 rounded hover:bg-red-500/10 text-red-400 transition-colors" title="Delete Rule">
                            <span class="material-symbols-outlined text-sm">delete</span>
                        </button>
                    </div>
                `;
                card.querySelector('.delete-rule-btn').onclick = () => deleteRule(rule.id);
                list.appendChild(card);
            });
            wrap.appendChild(list);
        }

        parent.appendChild(wrap);
    }

    function parseRemediationSql(text) {
        if (!text) return [];
        const fixes = [];
        const remediationSection = text.split(/### Remediation Scripts/i)[1];
        if (!remediationSection) return [];
        const nextHeaderIdx = remediationSection.search(/\n### /);
        const sectionContent = nextHeaderIdx === -1 ? remediationSection : remediationSection.substring(0, nextHeaderIdx);
        const fixRegex = /####\s*(.*?)\n\s*```sql\n([\s\S]*?)```/g;
        let match;
        while ((match = fixRegex.exec(sectionContent)) !== null) {
            fixes.push({ title: match[1].trim(), sql: match[2].trim() });
        }
        return fixes;
    }

    function renderTrends(parent) {
        if (state.trends.length < 2) {
            parent.innerHTML = `
                 <div class="h-full flex flex-col items-center justify-center gap-4 opacity-50 ${classes.text.primary}">
                    <span class="material-symbols-outlined text-5xl">show_chart</span>
                    <div class="text-center">
                        <h3 class="font-bold">Not Enough Data</h3>
                        <p class="text-sm ${classes.text.secondary}">Run more analyses to see trends over time. Need at least 2 data points.</p>
                    </div>
                </div>
            `;
            return;
        }
        const card = document.createElement('div');
        card.className = `${classes.card} h-full flex flex-col`;
        card.innerHTML = `
            <div class="flex items-center justify-between mb-6">
                <h3 class="text-sm font-bold uppercase tracking-wider ${classes.text.secondary}">Quality Score Trend</h3>
            </div>
            <div class="chart-container flex-1 min-h-[300px] relative">
                ${renderLineChart(state.trends)}
            </div>
        `;
        parent.appendChild(card);
    }

    function renderLineChart(data) {
        const width = 800;
        const height = 300;
        const padding = 40;
        const dataPoints = data.map((d, i) => ({
            date: new Date(d.timestamp),
            score: d.overall_score,
            report: d,
            index: i
        }));
        const minTime = Math.min(...dataPoints.map(d => d.date));
        const maxTime = Math.max(...dataPoints.map(d => d.date));
        const timeRange = maxTime - minTime || 1;
        const xScale = (date) => padding + ((date - minTime) / timeRange) * (width - padding * 2);
        const yScale = (score) => height - padding - (score / 100) * (height - padding * 2);
        const points = dataPoints.map(d => `${xScale(d.date)},${yScale(d.score)}`).join(' ');
        const gridColor = theme === 'light' ? '#e5e7eb' : (theme === 'dawn' ? '#f2e9e1' : (theme === 'neon' ? '#ffffff10' : '#ffffff20'));
        const textColor = theme === 'light' ? '#9ca3af' : (theme === 'dawn' ? '#9893a5' : (theme === 'neon' ? '#00f3ff60' : '#6b7280'));
        const lineColor = theme === 'dawn' ? '#ea9d34' : (theme === 'neon' ? '#00f3ff' : '#0ea5e9');
        const yGrid = [0, 25, 50, 75, 100].map(val => `
            <line x1="${padding}" y1="${yScale(val)}" x2="${width - padding}" y2="${yScale(val)}" stroke="${gridColor}" stroke-dasharray="4" />
            <text x="${padding - 10}" y="${yScale(val)}" dy="4" text-anchor="end" font-size="10" fill="${textColor}">${val}</text>
        `).join('');
        const dots = dataPoints.map(d => `
            <circle cx="${xScale(d.date)}" cy="${yScale(d.score)}" r="6" 
                fill="${getScoreColor(d.score)}" 
                stroke="${state.currentReport?.timestamp === d.report.timestamp ? (theme === 'neon' ? '#fff' : '#000') : (theme === 'light' ? '#fff' : '#1f2937')}" 
                stroke-width="${state.currentReport?.timestamp === d.report.timestamp ? '3' : '2'}"
                class="trend-dot cursor-pointer hover:r-8 transition-all"
                data-timestamp="${d.report.timestamp}">
                <title>${d.score.toFixed(1)} on ${d.date.toLocaleString()}</title>
            </circle>
        `).join('');
        const chartId = `chart-${Math.random().toString(36).substr(2, 9)}`;
        setTimeout(() => {
            const svgEl = document.getElementById(chartId);
            if (svgEl) {
                svgEl.onclick = (e) => {
                    const dot = e.target.closest('.trend-dot');
                    if (dot) {
                        const ts = dot.getAttribute('data-timestamp');
                        const report = state.trends.find(t => t.timestamp === ts);
                        if (report) {
                            state.currentReport = report;
                            state.activeTab = 'overview';
                            loadSavedAiAnalysisForReport(report);
                            render();
                        }
                    }
                };
            }
        }, 0);
        return `
            <svg id="${chartId}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width: 100%; height: 100%;">
                ${yGrid}
                <polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                ${dots}
            </svg>
        `;
    }

    function renderStats(metric) {
        if (metric.min_value !== null) {
            return `<div class="leading-tight">Min: <span class="font-mono">${metric.min_value}</span><br>Max: <span class="font-mono">${metric.max_value}</span></div>`;
        }
        return '<span class="opacity-50">-</span>';
    }

    function renderTopValuesAndPatterns(metric) {
        let html = '';
        if (metric.top_values && metric.top_values.length > 0) {
            html += `
                <div class="mb-2">
                    <span class="text-[9px] font-bold opacity-50 uppercase mb-1 block">Top Values</span>
                    <div class="flex flex-wrap gap-1">
                        ${metric.top_values.slice(0, 3).map(v => `
                            <span class="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] border border-blue-500/20" title="Count: ${v.count}">
                                ${v.value.length > 15 ? v.value.substring(0, 15) + '...' : v.value}
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        if (metric.pattern_metrics && metric.pattern_metrics.length > 0) {
            html += `
                <div>
                    <span class="text-[9px] font-bold opacity-50 uppercase mb-1 block">Detected Patterns</span>
                    <div class="flex flex-wrap gap-1">
                        ${metric.pattern_metrics.map(p => `
                            <span class="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 text-[10px] border border-purple-500/20" title="${p.count} matches (${p.percentage.toFixed(1)}%)">
                                ${p.pattern_name} (${p.percentage.toFixed(0)}%)
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        return html || '<span class="opacity-30 text-xs">-</span>';
    }

    function getScoreColor(score) {
        if (score >= 90) return '#10b981';
        if (score >= 70) return '#f59e0b';
        return '#ef4444';
    }

    function formatIssueType(type) {
        if (typeof type === 'string') return type;
        if (type && typeof type === 'object') {
            const entries = Object.entries(type);
            if (entries.length > 0) {
                const [key, value] = entries[0];
                if (key === 'Other' && value) return `Other (${value})`;
                return key;
            }
        }
        return 'Unknown';
    }

    function formatIssueSeverity(severity) {
        if (typeof severity === 'string') return severity;
        if (severity && typeof severity === 'object') {
            const keys = Object.keys(severity);
            if (keys.length > 0) return keys[0];
        }
        return 'Unknown';
    }

    const onThemeChange = (e) => {
        theme = e.detail.theme;
        classes = getClasses(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    init();
    return container;
}
