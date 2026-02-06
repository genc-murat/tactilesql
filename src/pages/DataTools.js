import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';

export function DataTools() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic' || t === 'ember' || t === 'aurora';
        return `flex-1 flex flex-col h-full overflow-auto custom-scrollbar ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} p-6 transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    // State
    let activeTab = 'export'; // 'export' | 'import' | 'backup' | 'mock'
    let databases = [];
    let tables = [];
    let selectedDb = '';
    let selectedTable = '';
    let isProcessing = false;
    let mockSchema = [];
    let mockSchemaKey = '';
    let mockPreview = null;
    let mockGenerationResult = null;
    let activeMockOperationId = null;
    let mockJobStatus = null;
    let mockStatusPollInterval = null;
    let mockLastFinalizedOpId = null;
    let mockJobHistory = [];
    const mockSettings = {
        rowCount: 100,
        seed: '',
        includeNullableColumns: true,
        dryRun: false,
        columnRules: {}
    };

    // Dropdown Instances
    let dropdowns = {
        db: null,
        table: null
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const resetMockOutputs = () => {
        stopMockStatusPolling();
        mockPreview = null;
        mockGenerationResult = null;
        mockJobStatus = null;
        activeMockOperationId = null;
        mockLastFinalizedOpId = null;
    };

    const resetMockSchema = () => {
        mockSchema = [];
        mockSchemaKey = '';
        mockSettings.columnRules = {};
        resetMockOutputs();
    };

    const currentMockSchemaKey = () => {
        if (!selectedDb || !selectedTable) return '';
        return `${selectedDb}.${selectedTable}`;
    };

    const ensurePositiveInt = (value, fallback = 1) => {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed) || parsed < 1) return fallback;
        return parsed;
    };

    const normalizeSeed = () => {
        const raw = String(mockSettings.seed || '').trim();
        if (!raw) return null;
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed < 0) return null;
        return parsed;
    };

    const HIGH_VOLUME_GUARD_THRESHOLD = 20000;
    const CRITICAL_TARGET_REGEX = /(prod|production|live|master|critical|primary)/i;

    const isCriticalMockTarget = () => {
        const target = `${selectedDb || ''}.${selectedTable || ''}`;
        return CRITICAL_TARGET_REGEX.test(target);
    };

    const stopMockStatusPolling = () => {
        if (mockStatusPollInterval) {
            clearInterval(mockStatusPollInterval);
            mockStatusPollInterval = null;
        }
    };

    const formatMockTime = (value) => {
        if (!value) return '-';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return parsed.toLocaleString();
    };

    const loadMockJobHistory = async () => {
        try {
            const history = await invoke('list_mock_data_generation_history', { limit: 30 });
            mockJobHistory = Array.isArray(history) ? history : [];
        } catch (error) {
            console.error('Failed to load mock job history:', error);
            mockJobHistory = [];
        } finally {
            if (activeTab === 'mock') {
                render();
            }
        }
    };

    const finalizeMockOperation = (status) => {
        if (!status) return;
        if (mockLastFinalizedOpId === status.operationId) return;
        mockLastFinalizedOpId = status.operationId;
        activeMockOperationId = null;
        stopMockStatusPolling();

        if (status.status === 'completed') {
            mockGenerationResult = {
                insertedRows: status.insertedRows,
                attemptedRows: status.totalRows,
                elapsedMs: 0,
                seed: status.seed,
                warnings: status.warnings || [],
                dryRun: !!status.dryRun
            };
            const title = status.dryRun ? 'Mock Dry Run Completed' : 'Mock Data Completed';
            const message = status.dryRun
                ? `Dry run completed for ${status.totalRows} rows.\nNo data inserted.\nSeed: ${status.seed}`
                : `Inserted ${status.insertedRows} rows.\nSeed: ${status.seed}`;
            Dialog.alert(message, title);
            loadMockJobHistory();
            return;
        }

        if (status.status === 'cancelled') {
            Dialog.alert(
                'Mock data generation cancelled. Transaction was rolled back.',
                'Mock Data Cancelled'
            );
            loadMockJobHistory();
            return;
        }

        if (status.status === 'failed') {
            Dialog.alert(
                `Mock data generation failed: ${status.error || 'Unknown error'}`,
                'Mock Data Error'
            );
            loadMockJobHistory();
        }
    };

    const pollMockOperationStatus = async (operationId) => {
        if (!operationId) return;
        try {
            const status = await invoke('get_mock_data_generation_status', { operationId });
            mockJobStatus = status;
            if (['completed', 'cancelled', 'failed'].includes(status.status)) {
                finalizeMockOperation(status);
            }
            render();
        } catch (error) {
            stopMockStatusPolling();
            activeMockOperationId = null;
            Dialog.alert(`Failed to fetch mock generation status: ${error}`, 'Mock Data Error');
            render();
        }
    };

    const startMockStatusPolling = (operationId) => {
        stopMockStatusPolling();
        pollMockOperationStatus(operationId);
        mockStatusPollInterval = setInterval(() => {
            pollMockOperationStatus(operationId);
        }, 1000);
    };

    // Load databases
    const loadDatabases = async () => {
        try {
            databases = await invoke('get_databases');
            render();
        } catch (error) {
            console.error('Failed to load databases:', error);
        }
    };

    const loadTables = async (db) => {
        if (!db) {
            tables = [];
            render();
            return;
        }
        try {
            tables = await invoke('get_tables', { database: db });
            render();
        } catch (error) {
            console.error('Failed to load tables:', error);
            tables = [];
            render();
        }
    };

    const loadMockSchema = async () => {
        const nextKey = currentMockSchemaKey();
        if (!nextKey) {
            resetMockSchema();
            render();
            return;
        }

        try {
            const schema = await invoke('get_table_schema', {
                database: selectedDb,
                table: selectedTable
            });
            mockSchema = Array.isArray(schema) ? schema : [];
            mockSchemaKey = nextKey;

            const nextRules = {};
            mockSchema.forEach((column) => {
                const existing = mockSettings.columnRules[column.name];
                nextRules[column.name] = existing || 'auto';
            });
            mockSettings.columnRules = nextRules;
            resetMockOutputs();
            render();
        } catch (error) {
            console.error('Failed to load mock schema:', error);
            resetMockSchema();
            Dialog.alert(`Failed to load table schema: ${error}`, 'Mock Data');
            render();
        }
    };

    // Export handlers
    const handleExportCSV = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return;
        }

        const fileName = `${selectedTable}_${new Date().toISOString().slice(0, 10)}.csv`;
        const filePath = await Dialog.prompt('Enter file path to save:', 'Export CSV', `/home/${fileName}`);
        if (!filePath) return;

        isProcessing = true;
        render();

        try {
            const result = await invoke('export_table_csv', {
                database: selectedDb,
                table: selectedTable,
                filePath: filePath,
                includeHeaders: true
            });
            Dialog.alert(result, 'Export Complete');
        } catch (error) {
            Dialog.alert(`Export failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleExportJSON = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return;
        }

        const fileName = `${selectedTable}_${new Date().toISOString().slice(0, 10)}.json`;
        const filePath = await Dialog.prompt('Enter file path to save:', 'Export JSON', `/home/${fileName}`);
        if (!filePath) return;

        isProcessing = true;
        render();

        try {
            const result = await invoke('export_table_json', {
                database: selectedDb,
                table: selectedTable,
                filePath: filePath
            });
            Dialog.alert(result, 'Export Complete');
        } catch (error) {
            Dialog.alert(`Export failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleExportSQL = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return;
        }

        const fileName = `${selectedTable}_${new Date().toISOString().slice(0, 10)}.sql`;
        const filePath = await Dialog.prompt('Enter file path to save:', 'Export SQL', `/home/${fileName}`);
        if (!filePath) return;

        isProcessing = true;
        render();

        try {
            const result = await invoke('export_table_sql', {
                database: selectedDb,
                table: selectedTable,
                filePath: filePath,
                includeCreate: true
            });
            Dialog.alert(result, 'Export Complete');
        } catch (error) {
            Dialog.alert(`Export failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleImportCSV = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return;
        }

        const filePath = await Dialog.prompt('Enter CSV file path to import:', 'Import CSV');
        if (!filePath) return;

        const hasHeaders = await Dialog.confirm('Does the CSV file have headers?', 'CSV Headers');

        isProcessing = true;
        render();

        try {
            const result = await invoke('import_csv', {
                database: selectedDb,
                table: selectedTable,
                filePath: filePath,
                hasHeaders: hasHeaders
            });

            let message = `Imported ${result.rows_imported} rows.`;
            if (result.errors.length > 0) {
                message += `\n\nErrors (${result.errors.length}):\n${result.errors.slice(0, 5).join('\n')}`;
                if (result.errors.length > 5) {
                    message += `\n... and ${result.errors.length - 5} more`;
                }
            }
            Dialog.alert(message, result.success ? 'Import Complete' : 'Import Completed with Errors');
        } catch (error) {
            Dialog.alert(`Import failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleImportExcel = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return;
        }

        const shouldContinue = await Dialog.confirm(
            'Direct .xlsx parsing is not available in this build.\n\nExport the sheet as CSV and continue with CSV import?',
            'Excel Import'
        );
        if (shouldContinue) {
            await handleImportCSV();
        }
    };

    // Backup handlers
    const handleBackup = async () => {
        if (!selectedDb) {
            Dialog.alert('Please select a database first.', 'Selection Required');
            return;
        }

        const fileName = `${selectedDb}_backup_${new Date().toISOString().slice(0, 10)}.sql`;
        const filePath = await Dialog.prompt('Enter file path to save backup:', 'Backup Database', `/home/${fileName}`);
        if (!filePath) return;

        const includeData = await Dialog.confirm('Include table data in backup?', 'Backup Options');

        isProcessing = true;
        render();

        try {
            const result = await invoke('backup_database', {
                database: selectedDb,
                filePath: filePath,
                includeData: includeData
            });
            Dialog.alert(result, 'Backup Complete');
        } catch (error) {
            Dialog.alert(`Backup failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleRestore = async () => {
        const filePath = await Dialog.prompt('Enter SQL file path to restore:', 'Restore Database');
        if (!filePath) return;

        const confirmed = await Dialog.confirm(
            'This will execute all SQL statements in the file. Continue?',
            'Confirm Restore'
        );
        if (!confirmed) return;

        isProcessing = true;
        render();

        try {
            const result = await invoke('restore_database', {
                filePath: filePath
            });
            Dialog.alert(result, 'Restore Complete');
            await loadDatabases();
        } catch (error) {
            Dialog.alert(`Restore failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const buildMockColumnRulesPayload = () => {
        const payload = {};
        Object.entries(mockSettings.columnRules).forEach(([column, generator]) => {
            payload[column] = { generator: generator || 'auto' };
        });
        return payload;
    };

    const ensureMockReady = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return false;
        }
        if (currentMockSchemaKey() !== mockSchemaKey || mockSchema.length === 0) {
            await loadMockSchema();
        }
        if (mockSchema.length === 0) {
            Dialog.alert('Table schema is empty. Select another table.', 'Mock Data');
            return false;
        }
        return true;
    };

    const handleMockPreview = async () => {
        if (activeMockOperationId && mockJobStatus && ['queued', 'running'].includes(mockJobStatus.status)) {
            Dialog.alert('Please wait for the active mock generation to finish or cancel it first.', 'Mock Data');
            return;
        }

        const ready = await ensureMockReady();
        if (!ready) return;

        const rowCount = ensurePositiveInt(mockSettings.rowCount, 20);
        const seed = normalizeSeed();

        isProcessing = true;
        render();

        try {
            const result = await invoke('preview_mock_data', {
                database: selectedDb,
                table: selectedTable,
                rowCount,
                seed,
                includeNullableColumns: !!mockSettings.includeNullableColumns,
                columnRules: buildMockColumnRulesPayload()
            });
            mockPreview = result;
            mockGenerationResult = null;
        } catch (error) {
            Dialog.alert(`Mock preview failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleMockGenerate = async () => {
        if (activeMockOperationId && mockJobStatus && ['queued', 'running'].includes(mockJobStatus.status)) {
            Dialog.alert('A mock generation operation is already running.', 'Mock Data');
            return;
        }

        const ready = await ensureMockReady();
        if (!ready) return;

        const rowCount = ensurePositiveInt(mockSettings.rowCount, 100);
        const seed = normalizeSeed();
        const dryRun = !!mockSettings.dryRun;

        if (dryRun) {
            const confirmedDryRun = await Dialog.confirm(
                `Run dry run for ${rowCount} rows on ${selectedDb}.${selectedTable}? No data will be inserted.`,
                'Confirm Dry Run'
            );
            if (!confirmedDryRun) return;
        } else {
            const confirmed = await Dialog.confirm(
                `Generate and insert ${rowCount} mock rows into ${selectedDb}.${selectedTable}?`,
                'Confirm Mock Data Generation'
            );
            if (!confirmed) return;

            if (rowCount >= HIGH_VOLUME_GUARD_THRESHOLD) {
                const confirmedHighVolume = await Dialog.confirm(
                    `High-volume operation detected (${rowCount} rows).\nDo you want to continue?`,
                    'High Volume Safety Check'
                );
                if (!confirmedHighVolume) return;
            }

            if (isCriticalMockTarget()) {
                const criticalConfirmed = await Dialog.confirm(
                    `Target looks like a production-critical schema/table (${selectedDb}.${selectedTable}).\nConfirm to continue.`,
                    'Critical Target Warning'
                );
                if (!criticalConfirmed) return;
            }
        }

        isProcessing = true;
        render();

        try {
            const status = await invoke('start_mock_data_generation', {
                database: selectedDb,
                table: selectedTable,
                rowCount,
                seed,
                includeNullableColumns: !!mockSettings.includeNullableColumns,
                columnRules: buildMockColumnRulesPayload(),
                dryRun
            });

            activeMockOperationId = status.operationId;
            mockJobStatus = status;
            mockLastFinalizedOpId = null;
            mockPreview = null;
            mockGenerationResult = null;
            startMockStatusPolling(status.operationId);
            loadMockJobHistory();
        } catch (error) {
            Dialog.alert(`Mock data generation failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleMockCancel = async () => {
        if (!activeMockOperationId) return;
        const confirmed = await Dialog.confirm(
            'Cancel the active mock generation operation?',
            'Cancel Mock Generation'
        );
        if (!confirmed) return;

        try {
            const status = await invoke('cancel_mock_data_generation', {
                operationId: activeMockOperationId
            });
            mockJobStatus = status;
            loadMockJobHistory();
            render();
        } catch (error) {
            Dialog.alert(`Failed to cancel operation: ${error}`, 'Mock Data');
        }
    };

    const renderMockRules = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const generators = [
            { value: 'auto', label: 'Auto' },
            { value: 'text', label: 'Text' },
            { value: 'integer', label: 'Integer' },
            { value: 'decimal', label: 'Decimal' },
            { value: 'boolean', label: 'Boolean' },
            { value: 'date', label: 'Date' },
            { value: 'datetime', label: 'DateTime' }
        ];

        if (mockSchema.length === 0) {
            return `
                <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50 text-gray-500' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed] text-[#9893a5]' : (isOceanic ? 'border-ocean-border bg-ocean-bg text-ocean-text/70' : 'border-white/10 bg-white/5 text-gray-400'))} p-4 text-sm">
                    Select a table to load column rules.
                </div>
            `;
        }

        const rows = mockSchema.map((column, idx) => {
            const selected = mockSettings.columnRules[column.name] || 'auto';
            const options = generators
                .map((g) => `<option value="${g.value}" ${selected === g.value ? 'selected' : ''}>${g.label}</option>`)
                .join('');
            return `
                <tr class="${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} border-b last:border-b-0">
                    <td class="py-2 pr-3 text-xs font-semibold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')}">${escapeHtml(column.name)}</td>
                    <td class="py-2 pr-3 text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">${escapeHtml(column.column_type || column.data_type || '-')}</td>
                    <td class="py-2 pr-3 text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">${column.is_nullable ? 'NULLABLE' : 'NOT NULL'}</td>
                    <td class="py-2">
                        <select data-column-index="${idx}" class="mock-generator-select w-full px-2 py-1 rounded border text-[11px] ${isLight ? 'bg-white border-gray-200 text-gray-700' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text' : 'bg-black/20 border-white/10 text-gray-200'))}">
                            ${options}
                        </select>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border' : 'border-white/10'))} overflow-hidden">
                <div class="px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : (isOceanic ? 'bg-ocean-bg text-ocean-text/70' : 'bg-white/5 text-gray-400'))}">
                    Column Generators
                </div>
                <div class="max-h-[260px] overflow-auto custom-scrollbar p-3">
                    <table class="w-full">
                        <thead>
                            <tr class="text-left text-[10px] uppercase tracking-widest ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">
                                <th class="pb-2 pr-3">Column</th>
                                <th class="pb-2 pr-3">Type</th>
                                <th class="pb-2 pr-3">Null</th>
                                <th class="pb-2">Generator</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;
    };

    const renderMockPreview = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

        if (!mockPreview || !Array.isArray(mockPreview.rows) || mockPreview.rows.length === 0) {
            return `
                <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/10 bg-white/5'))} p-4 text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">
                    Run <b>Preview</b> to see generated sample rows.
                </div>
            `;
        }

        const headers = (mockPreview.columns || []).map((col) => `<th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">${escapeHtml(col)}</th>`).join('');
        const rows = mockPreview.rows.map((row) => {
            const cells = row.map((cell) => {
                if (cell === null || typeof cell === 'undefined') {
                    return `<td class="px-2 py-1.5 text-[11px] italic ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">NULL</td>`;
                }
                return `<td class="px-2 py-1.5 text-[11px] ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${escapeHtml(cell)}</td>`;
            }).join('');
            return `<tr class="${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} border-b last:border-b-0">${cells}</tr>`;
        }).join('');

        const warningText = (mockPreview.warnings || []).length > 0
            ? `<div class="text-[10px] mt-2 ${isLight ? 'text-amber-600' : (isDawn ? 'text-[#ea9d34]' : 'text-amber-400')}">${escapeHtml(mockPreview.warnings.join(' | '))}</div>`
            : '';

        return `
            <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border' : 'border-white/10'))} overflow-hidden">
                <div class="px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : (isOceanic ? 'bg-ocean-bg text-ocean-text/70' : 'bg-white/5 text-gray-400'))}">
                    Preview Rows (${mockPreview.rows.length}) | Seed ${mockPreview.seed}
                </div>
                <div class="max-h-[280px] overflow-auto custom-scrollbar">
                    <table class="w-full">
                        <thead class="${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">
                            <tr>${headers}</tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
            ${warningText}
        `;
    };

    const renderMockJobStatus = () => {
        if (!mockJobStatus) return '';
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const progress = Math.max(0, Math.min(100, Number(mockJobStatus.progressPct || 0)));
        const status = String(mockJobStatus.status || '').toLowerCase();
        const isRunning = status === 'queued' || status === 'running';
        const statusColor = status === 'completed'
            ? (isDawn ? 'text-[#286983]' : 'text-emerald-500')
            : status === 'failed'
                ? (isDawn ? 'text-[#b4637a]' : 'text-red-500')
                : status === 'cancelled'
                    ? (isDawn ? 'text-[#ea9d34]' : 'text-amber-500')
                    : (isDawn ? 'text-[#31748f]' : 'text-mysql-teal');

        const warnings = (mockJobStatus.warnings || [])
            .map((w) => `<li>${escapeHtml(w)}</li>`)
            .join('');

        return `
            <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/10 bg-white/5'))} p-3 space-y-2">
                <div class="flex items-center justify-between">
                    <div class="text-[10px] font-black uppercase tracking-[0.18em] ${statusColor}">Operation: ${escapeHtml(status)}</div>
                    ${isRunning ? `
                        <button id="mock-cancel-btn" class="px-2 py-1 rounded text-[10px] font-bold ${isDawn ? 'bg-[#b4637a] text-white' : 'bg-red-500 text-white'} hover:brightness-110 transition-all">
                            Cancel
                        </button>
                    ` : ''}
                </div>
                <div class="w-full h-2 rounded ${isLight ? 'bg-gray-200' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/10')} overflow-hidden">
                    <div class="h-full ${isDawn ? 'bg-[#31748f]' : 'bg-mysql-teal'} transition-all duration-300" style="width:${progress}%"></div>
                </div>
                <div class="text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                    ${mockJobStatus.insertedRows || 0} / ${mockJobStatus.totalRows || 0} rows
                    ${mockJobStatus.dryRun ? '(dry run)' : ''}
                </div>
                ${mockJobStatus.error ? `<div class="text-[11px] ${isLight ? 'text-red-600' : (isDawn ? 'text-[#b4637a]' : 'text-red-400')}">${escapeHtml(mockJobStatus.error)}</div>` : ''}
                ${warnings ? `<ul class="text-[11px] ${isLight ? 'text-amber-600' : (isDawn ? 'text-[#ea9d34]' : 'text-amber-400')} list-disc pl-4">${warnings}</ul>` : ''}
            </div>
        `;
    };

    const renderMockJobHistory = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

        if (!Array.isArray(mockJobHistory) || mockJobHistory.length === 0) {
            return `
                <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/10 bg-white/5'))} p-3 text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">
                    No mock job history yet.
                </div>
            `;
        }

        const rows = mockJobHistory.slice(0, 12).map((job) => {
            const status = String(job.status || '').toLowerCase();
            const statusClass = status === 'completed'
                ? (isDawn ? 'text-[#286983]' : 'text-emerald-500')
                : status === 'failed'
                    ? (isDawn ? 'text-[#b4637a]' : 'text-red-500')
                    : status === 'cancelled'
                        ? (isDawn ? 'text-[#ea9d34]' : 'text-amber-500')
                        : (isDawn ? 'text-[#31748f]' : 'text-mysql-teal');
            const rowsLabel = `${job.insertedRows || 0}/${job.totalRows || 0}`;
            const target = `${job.database || '-'} . ${job.table || '-'}`;
            return `
                <tr class="${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} border-b last:border-b-0">
                    <td class="px-2 py-2 text-[11px] font-semibold ${statusClass}">${escapeHtml(status)}</td>
                    <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${escapeHtml(target)}</td>
                    <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${escapeHtml(rowsLabel)}${job.dryRun ? ' (dry)' : ''}</td>
                    <td class="px-2 py-2 text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">${escapeHtml(formatMockTime(job.startedAt))}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border' : 'border-white/10'))} overflow-hidden">
                <div class="px-3 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : (isOceanic ? 'bg-ocean-bg text-ocean-text/70' : 'bg-white/5 text-gray-400'))}">
                    <span>Recent Jobs</span>
                    <button id="mock-history-refresh-btn" class="px-2 py-1 rounded text-[10px] font-bold ${isDawn ? 'bg-[#31748f] text-white' : 'bg-mysql-teal text-white'} hover:brightness-110 transition-all">Refresh</button>
                </div>
                <div class="max-h-[220px] overflow-auto custom-scrollbar">
                    <table class="w-full">
                        <thead class="${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">
                            <tr>
                                <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Status</th>
                                <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Target</th>
                                <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Rows</th>
                                <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Started</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;
    };

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

        container.innerHTML = `
            <div class="w-full h-full">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${isDawn ? 'from-[#ea9d34] to-[#eb6f92]' : 'from-mysql-teal to-mysql-cyan'} flex items-center justify-center shadow-lg">
                            <span class="material-symbols-outlined text-white text-2xl">swap_horiz</span>
                        </div>
                        <div>
                            <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Data Tools</h1>
                            <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Import, Export, Backup & Mock Data</p>
                        </div>
                    </div>
                </div>

                <!-- Tabs -->
                <div class="flex items-center gap-2 mb-6 p-1 rounded-lg ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-panel' : 'bg-white/5'))} w-fit">
                    <button id="tab-export" class="px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'export' ? (isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg' : 'bg-mysql-teal text-white shadow-lg') : (isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#575279] hover:text-[#286983]' : 'text-gray-400 hover:text-white'))}">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">upload</span>
                        Export
                    </button>
                    <button id="tab-import" class="px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'import' ? (isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg' : 'bg-mysql-teal text-white shadow-lg') : (isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#575279] hover:text-[#286983]' : 'text-gray-400 hover:text-white'))}">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">download</span>
                        Import
                    </button>
                    <button id="tab-backup" class="px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'backup' ? (isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg' : 'bg-mysql-teal text-white shadow-lg') : (isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#575279] hover:text-[#286983]' : 'text-gray-400 hover:text-white'))}">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">backup</span>
                        Backup & Restore
                    </button>
                    <button id="tab-mock" class="px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'mock' ? (isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg' : 'bg-mysql-teal text-white shadow-lg') : (isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#575279] hover:text-[#286983]' : 'text-gray-400 hover:text-white'))}">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">science</span>
                        Mock Data
                    </button>
                </div>

                <!-- Selection Panel -->
                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div class="space-y-2">
                        <label class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Database</label>
                        <div id="db-select-container"></div>
                    </div>
                    ${activeTab !== 'backup' ? `
                    <div class="space-y-2">
                        <label class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Table</label>
                        <div id="table-select-container"></div>
                    </div>
                    ` : '<div></div>'}
                </div>

                <!-- Content Panel -->
                <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} p-6">
                    ${isProcessing ? renderProcessing() : renderTabContent()}
                </div>
            </div>
        `;

        attachEvents();

        // Initialize Dropdowns
        const dbContainer = container.querySelector('#db-select-container');
        const tableContainer = container.querySelector('#table-select-container');

        if (dbContainer) {
            dropdowns.db = new CustomDropdown({
                items: databases.map(db => ({ value: db, label: db, icon: 'database' })),
                value: selectedDb,
                placeholder: 'Select database...',
                onSelect: (val) => {
                    selectedDb = val;
                    selectedTable = '';
                    resetMockSchema();
                    loadTables(selectedDb);
                }
            });
            dbContainer.appendChild(dropdowns.db.getElement());
        }

        if (tableContainer) {
            if (!selectedDb) {
                tableContainer.innerHTML = `
                    <div class="h-[38px] px-3 flex items-center text-sm ${isLight ? 'bg-gray-100/50 text-gray-400' : 'bg-white/5 text-gray-500'} rounded-lg border ${isLight ? 'border-gray-200' : 'border-white/10'} cursor-not-allowed italic">
                        Select database first
                    </div>
                `;
            } else {
                dropdowns.table = new CustomDropdown({
                    items: tables.map(t => ({ value: t, label: t, icon: 'table' })),
                    value: selectedTable,
                    placeholder: 'Select table...',
                    onSelect: async (val) => {
                        selectedTable = val;
                        resetMockOutputs();
                        mockSchema = [];
                        mockSchemaKey = '';
                        render();
                        if (activeTab === 'mock') {
                            loadMockJobHistory();
                            await loadMockSchema();
                        }
                    }
                });
                tableContainer.appendChild(dropdowns.table.getElement());
            }
        }
    };

    const renderProcessing = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        return `
            <div class="flex flex-col items-center justify-center py-12">
                <div class="w-16 h-16 rounded-full ${isLight ? 'bg-mysql-teal/10' : (isDawn ? 'bg-[#ea9d34]/20' : 'bg-mysql-teal/20')} flex items-center justify-center mb-4">
                    <span class="material-symbols-outlined text-3xl ${isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal'} animate-spin">progress_activity</span>
                </div>
                <p class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Processing...</p>
                <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Please wait while the operation completes</p>
            </div>
        `;
    };

    const renderTabContent = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

        if (activeTab === 'export') {
            return `
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-4">Export Data</h3>
                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} mb-6">
                        Export table data to various formats. Select a database and table above.
                    </p>
                    
                    <div class="grid grid-cols-3 gap-4">
                        <!-- CSV Export -->
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200 hover:border-mysql-teal' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1] hover:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border hover:border-ocean-frost' : 'bg-white/5 border border-white/10 hover:border-mysql-teal'))} transition-all cursor-pointer group" id="export-csv">
                            <div class="flex items-center gap-3 mb-3">
                                <div class="w-10 h-10 rounded-lg ${isDawn ? 'bg-[#9ccfd8]/20' : 'bg-green-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined ${isDawn ? 'text-[#9ccfd8]' : 'text-green-500'}">csv</span>
                                </div>
                                <div>
                                    <h4 class="font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">CSV</h4>
                                    <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Comma-separated</p>
                                </div>
                            </div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Export data to CSV format for spreadsheets</p>
                        </div>
                        
                        <!-- JSON Export -->
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200 hover:border-mysql-teal' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1] hover:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border hover:border-ocean-frost' : 'bg-white/5 border border-white/10 hover:border-mysql-teal'))} transition-all cursor-pointer group" id="export-json">
                            <div class="flex items-center gap-3 mb-3">
                                <div class="w-10 h-10 rounded-lg ${isDawn ? 'bg-[#f6c177]/20' : 'bg-yellow-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined ${isDawn ? 'text-[#f6c177]' : 'text-yellow-500'}">data_object</span>
                                </div>
                                <div>
                                    <h4 class="font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">JSON</h4>
                                    <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">JavaScript Object</p>
                                </div>
                            </div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Export data to JSON for APIs and apps</p>
                        </div>
                        
                        <!-- SQL Export -->
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200 hover:border-mysql-teal' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1] hover:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border hover:border-ocean-frost' : 'bg-white/5 border border-white/10 hover:border-mysql-teal'))} transition-all cursor-pointer group" id="export-sql">
                            <div class="flex items-center gap-3 mb-3">
                                <div class="w-10 h-10 rounded-lg ${isDawn ? 'bg-[#c4a7e7]/20' : 'bg-blue-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined ${isDawn ? 'text-[#c4a7e7]' : 'text-blue-500'}">code</span>
                                </div>
                                <div>
                                    <h4 class="font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">SQL</h4>
                                    <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">INSERT Statements</p>
                                </div>
                            </div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Export with CREATE TABLE and INSERT</p>
                        </div>
                    </div>
                </div>
            `;
        }

        if (activeTab === 'import') {
            return `
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-4">Import Data</h3>
                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} mb-6">
                        Import data from external files into existing tables.
                    </p>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <!-- CSV Import -->
                        <div class="p-6 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200 hover:border-mysql-teal' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1] hover:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border hover:border-ocean-frost' : 'bg-white/5 border border-white/10 hover:border-mysql-teal'))} transition-all cursor-pointer" id="import-csv">
                            <div class="flex items-center gap-4 mb-4">
                                <div class="w-14 h-14 rounded-xl ${isDawn ? 'bg-[#9ccfd8]/20' : 'bg-green-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined text-3xl ${isDawn ? 'text-[#9ccfd8]' : 'text-green-500'}">upload_file</span>
                                </div>
                                <div>
                                    <h4 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Import CSV</h4>
                                    <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Import from comma-separated file</p>
                                </div>
                            </div>
                            <ul class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} space-y-1">
                                <li>• Supports files with or without headers</li>
                                <li>• Auto-maps columns by order</li>
                                <li>• Reports import errors</li>
                            </ul>
                        </div>
                        
                        <div class="p-6 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200 hover:border-mysql-teal' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1] hover:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border hover:border-ocean-frost' : 'bg-white/5 border border-white/10 hover:border-mysql-teal'))} transition-all cursor-pointer" id="import-excel">
                            <div class="flex items-center gap-4 mb-4">
                                <div class="w-14 h-14 rounded-xl ${isDawn ? 'bg-[#c4a7e7]/20' : 'bg-purple-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined text-3xl ${isDawn ? 'text-[#c4a7e7]' : 'text-purple-500'}">table_view</span>
                                </div>
                                <div>
                                    <h4 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Import Excel</h4>
                                    <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">.xlsx to CSV flow</p>
                                </div>
                            </div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Convert workbook to CSV, then continue with guided import.</p>
                        </div>
                    </div>
                </div>
            `;
        }

        if (activeTab === 'mock') {
            const seedValue = escapeHtml(mockSettings.seed || '');
            const rowCountValue = ensurePositiveInt(mockSettings.rowCount, 100);
            const summary = mockGenerationResult
                ? `
                    <div class="rounded-lg border ${isLight ? 'border-green-200 bg-green-50' : (isDawn ? 'border-[#9ccfd8] bg-[#eff8f8]' : (isOceanic ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-emerald-400/30 bg-emerald-500/10'))} p-3">
                        <div class="text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-green-700' : (isDawn ? 'text-[#286983]' : 'text-emerald-300')}">Last Run</div>
                        <div class="mt-1 text-sm ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">
                            Inserted <b>${mockGenerationResult.insertedRows}</b> / ${mockGenerationResult.attemptedRows} rows in <b>${mockGenerationResult.elapsedMs} ms</b>
                        </div>
                        <div class="mt-1 text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Seed: ${mockGenerationResult.seed}</div>
                    </div>
                `
                : '';

            return `
                <div class="space-y-5">
                    <div>
                        <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-2">Mock Data Generator</h3>
                        <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                            Generate deterministic sample rows for the selected table using optional seed and column-level generator rules.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div class="space-y-3">
                            <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/10 bg-white/5'))} p-3 space-y-3">
                                <div>
                                    <label class="block text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Row Count</label>
                                    <input id="mock-row-count" type="number" min="1" max="100000" value="${rowCountValue}" class="w-full tactile-input text-sm py-1.5" />
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Seed (Optional)</label>
                                    <input id="mock-seed" type="number" min="0" value="${seedValue}" class="w-full tactile-input text-sm py-1.5" placeholder="e.g. 42" />
                                </div>
                                <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                                    <input id="mock-include-nullable" type="checkbox" class="w-4 h-4" ${mockSettings.includeNullableColumns ? 'checked' : ''} />
                                    Include nullable columns
                                </label>
                                <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                                    <input id="mock-dry-run" type="checkbox" class="w-4 h-4" ${mockSettings.dryRun ? 'checked' : ''} />
                                    Dry run (preview insert only, no writes)
                                </label>
                                <div class="grid grid-cols-2 gap-2 pt-1">
                                    <button id="mock-preview-btn" class="px-3 py-2 rounded-lg text-xs font-bold ${isDawn ? 'bg-[#31748f] text-white hover:brightness-110' : 'bg-mysql-teal text-white hover:brightness-110'} transition-all">
                                        Preview
                                    </button>
                                    <button id="mock-generate-btn" class="px-3 py-2 rounded-lg text-xs font-bold ${isDawn ? 'bg-[#ea9d34] text-[#fffaf3] hover:brightness-110' : 'bg-emerald-500 text-white hover:brightness-110'} transition-all">
                                        ${mockSettings.dryRun ? 'Run Dry Run' : 'Generate'}
                                    </button>
                                </div>
                            </div>
                            ${summary}
                        </div>

                        <div class="xl:col-span-2 space-y-4">
                            ${renderMockJobStatus()}
                            ${renderMockJobHistory()}
                            ${renderMockRules()}
                            ${renderMockPreview()}
                        </div>
                    </div>
                </div>
            `;
        }

        if (activeTab === 'backup') {
            return `
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-4">Backup & Restore</h3>
                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} mb-6">
                        Create full database backups or restore from existing backup files.
                    </p>
                    
                    <div class="grid grid-cols-2 gap-6">
                        <!-- Backup -->
                        <div class="p-6 rounded-xl ${isLight ? 'bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : (isOceanic ? 'bg-gradient-to-br from-ocean-accent/10 to-ocean-frost/10 border border-ocean-frost/30' : 'bg-gradient-to-br from-mysql-teal/10 to-mysql-cyan/10 border border-mysql-teal/30'))} cursor-pointer transition-all hover:scale-[1.02]" id="btn-backup">
                            <div class="flex items-center gap-4 mb-4">
                                <div class="w-16 h-16 rounded-2xl ${isDawn ? 'bg-[#31748f] text-[#fffaf3]' : 'bg-gradient-to-br from-blue-500 to-blue-600'} flex items-center justify-center shadow-lg">
                                    <span class="material-symbols-outlined text-4xl ${isDawn ? 'text-[#fffaf3]' : 'text-white'}">backup</span>
                                </div>
                                <div>
                                    <h4 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Create Backup</h4>
                                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Full database export</p>
                                </div>
                            </div>
                            <ul class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} space-y-2">
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    Tables, Views, Triggers
                                </li>
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    Stored Procedures & Functions
                                </li>
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    Optional: Include data
                                </li>
                            </ul>
                        </div>
                        
                        <!-- Restore -->
                        <div class="p-6 rounded-xl ${isLight ? 'bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : (isOceanic ? 'bg-gradient-to-br from-orange-500/10 to-yellow-500/10 border border-orange-500/30' : 'bg-gradient-to-br from-orange-500/10 to-yellow-500/10 border border-orange-500/30'))} cursor-pointer transition-all hover:scale-[1.02]" id="btn-restore">
                            <div class="flex items-center gap-4 mb-4">
                                <div class="w-16 h-16 rounded-2xl ${isDawn ? 'bg-[#ea9d34] text-[#fffaf3]' : 'bg-gradient-to-br from-orange-500 to-yellow-500'} flex items-center justify-center shadow-lg">
                                    <span class="material-symbols-outlined text-4xl text-white">restore</span>
                                </div>
                                <div>
                                    <h4 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Restore Backup</h4>
                                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Import from SQL file</p>
                                </div>
                            </div>
                            <ul class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} space-y-2">
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#ea9d34]' : 'text-yellow-500'}">warning</span>
                                    Execute all SQL statements
                                </li>
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    Supports TactileSQL backups
                                </li>
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    mysqldump compatible
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        }
    };

    const attachEvents = () => {
        // Tab switching
        container.querySelector('#tab-export')?.addEventListener('click', () => {
            activeTab = 'export';
            render();
        });
        container.querySelector('#tab-import')?.addEventListener('click', () => {
            activeTab = 'import';
            render();
        });
        container.querySelector('#tab-backup')?.addEventListener('click', () => {
            activeTab = 'backup';
            render();
        });
        container.querySelector('#tab-mock')?.addEventListener('click', async () => {
            activeTab = 'mock';
            render();
            loadMockJobHistory();
            if (selectedDb && selectedTable && currentMockSchemaKey() !== mockSchemaKey) {
                await loadMockSchema();
            }
        });

        // Backup/Restore buttons
        container.querySelector('#export-csv')?.addEventListener('click', handleExportCSV);
        container.querySelector('#export-json')?.addEventListener('click', handleExportJSON);
        container.querySelector('#export-sql')?.addEventListener('click', handleExportSQL);

        // Import button
        container.querySelector('#import-csv')?.addEventListener('click', handleImportCSV);
        container.querySelector('#import-excel')?.addEventListener('click', handleImportExcel);

        // Backup/Restore buttons
        container.querySelector('#btn-backup')?.addEventListener('click', handleBackup);
        container.querySelector('#btn-restore')?.addEventListener('click', handleRestore);

        // Mock buttons
        container.querySelector('#mock-preview-btn')?.addEventListener('click', handleMockPreview);
        container.querySelector('#mock-generate-btn')?.addEventListener('click', handleMockGenerate);
        container.querySelector('#mock-row-count')?.addEventListener('change', (e) => {
            mockSettings.rowCount = ensurePositiveInt(e.target.value, 100);
            e.target.value = String(mockSettings.rowCount);
        });
        container.querySelector('#mock-seed')?.addEventListener('change', (e) => {
            mockSettings.seed = e.target.value;
        });
        container.querySelector('#mock-include-nullable')?.addEventListener('change', (e) => {
            mockSettings.includeNullableColumns = !!e.target.checked;
        });
        container.querySelector('#mock-dry-run')?.addEventListener('change', (e) => {
            mockSettings.dryRun = !!e.target.checked;
            render();
        });
        container.querySelector('#mock-cancel-btn')?.addEventListener('click', handleMockCancel);
        container.querySelector('#mock-history-refresh-btn')?.addEventListener('click', loadMockJobHistory);
        container.querySelectorAll('.mock-generator-select').forEach((select) => {
            select.addEventListener('change', (e) => {
                const columnIndex = Number.parseInt(e.target.dataset.columnIndex || '-1', 10);
                const columnName = mockSchema[columnIndex]?.name;
                if (!columnName) return;
                mockSettings.columnRules[columnName] = e.target.value || 'auto';
            });
        });
    };

    // Theme handling
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        container.className = getContainerClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
        stopMockStatusPolling();
    };

    // Initialize - render first, then load data
    render();
    loadDatabases();

    return container;
}
