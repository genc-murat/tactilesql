import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { CustomDropdown } from '../components/UI/CustomDropdown.js';
import { DataCompareApi } from '../api/dataCompare.js';
import { DataTransferApi } from '../api/dataTransfer.js';

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
    let activeTab = 'export'; // 'export' | 'import' | 'backup' | 'mock' | 'compare' | 'transfer'
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
    let compareSourceDb = '';
    let compareSourceTable = '';
    let compareTargetDb = '';
    let compareTargetTable = '';
    let compareSourceTables = [];
    let compareTargetTables = [];
    let compareSourceSchema = [];
    let compareTargetSchema = [];
    let compareSharedColumns = [];
    let compareSharedPkColumns = [];
    let compareSelectedKeyColumns = [];
    let compareSelectedCompareColumns = [];
    let compareResult = null;
    let comparePlan = null;
    let compareError = '';
    let transferConnections = [];
    let transferSourceConnectionId = '';
    let transferTargetConnectionId = '';
    let transferSourceDatabase = '';
    let transferTargetDatabase = '';
    let transferObjects = [];
    let transferDraftSourceTable = '';
    let transferDraftTargetTable = '';
    let transferDraftMode = 'append';
    let transferDraftKeyColumns = '';
    let transferDraftSinkType = 'database';
    let transferDraftSinkPath = '';
    let transferMappingSourceColumn = '';
    let transferMappingTargetColumn = '';
    let transferMappingCastType = '';
    let transferMappingValidationMessage = '';
    let transferIncludeSchemaMigration = false;
    let transferLockGuard = true;
    let transferDryRun = true;
    let transferMappingProfile = '';
    let transferPlanPreview = null;
    let transferTaskPayload = null;
    let transferError = '';
    let transferRunHistory = [];
    let transferActiveRun = null;
    let transferActiveOperationId = null;
    let transferStatusPollInterval = null;
    const mockSettings = {
        rowCount: 100,
        seed: '',
        includeNullableColumns: true,
        dryRun: false,
        columnRules: {}
    };
    const compareSettings = {
        sampleLimit: 50,
        maxRows: 20000,
        includeInserts: true,
        includeUpdates: true,
        includeDeletes: false,
        wrapInTransaction: true,
        statementLimit: 10000
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

    const normalizeColumnToken = (value) => String(value || '').trim().toLowerCase();

    const uniqueTokens = (items) => {
        const seen = new Set();
        const out = [];
        items.forEach((item) => {
            const token = normalizeColumnToken(item);
            if (!token || seen.has(token)) return;
            seen.add(token);
            out.push(token);
        });
        return out;
    };

    const orderTokensBySharedColumns = (tokens) => {
        const index = new Map(compareSharedColumns.map((col, idx) => [col.token, idx]));
        return uniqueTokens(tokens)
            .filter((token) => index.has(token))
            .sort((a, b) => index.get(a) - index.get(b));
    };

    const tokenToSourceColumnName = (token) => {
        const entry = compareSharedColumns.find((column) => column.token === token);
        return entry?.sourceName || token;
    };

    const resetCompareColumnState = () => {
        compareSourceSchema = [];
        compareTargetSchema = [];
        compareSharedColumns = [];
        compareSharedPkColumns = [];
        compareSelectedKeyColumns = [];
        compareSelectedCompareColumns = [];
    };

    const resetCompareOutputs = () => {
        compareResult = null;
        comparePlan = null;
        compareError = '';
    };

    const loadCompareTables = async (side, database) => {
        if (!database) {
            if (side === 'source') compareSourceTables = [];
            else compareTargetTables = [];
            render();
            return;
        }

        try {
            const rows = await invoke('get_tables', { database });
            if (side === 'source') {
                compareSourceTables = Array.isArray(rows) ? rows : [];
                if (compareSourceTable && !compareSourceTables.includes(compareSourceTable)) {
                    compareSourceTable = '';
                }
            } else {
                compareTargetTables = Array.isArray(rows) ? rows : [];
                if (compareTargetTable && !compareTargetTables.includes(compareTargetTable)) {
                    compareTargetTable = '';
                }
            }
        } catch (error) {
            console.error(`Failed to load compare tables for ${database}:`, error);
            if (side === 'source') compareSourceTables = [];
            else compareTargetTables = [];
        } finally {
            render();
        }
    };

    const loadCompareMetadata = async () => {
        if (!compareSourceDb || !compareSourceTable || !compareTargetDb || !compareTargetTable) {
            resetCompareColumnState();
            render();
            return;
        }

        try {
            const [sourceSchema, targetSchema, sourcePks, targetPks] = await Promise.all([
                invoke('get_table_schema', { database: compareSourceDb, table: compareSourceTable }),
                invoke('get_table_schema', { database: compareTargetDb, table: compareTargetTable }),
                invoke('get_table_primary_keys', { database: compareSourceDb, table: compareSourceTable }),
                invoke('get_table_primary_keys', { database: compareTargetDb, table: compareTargetTable })
            ]);
            compareSourceSchema = Array.isArray(sourceSchema) ? sourceSchema : [];
            compareTargetSchema = Array.isArray(targetSchema) ? targetSchema : [];

            const targetByToken = new Map();
            compareTargetSchema.forEach((column) => {
                const token = normalizeColumnToken(column.name);
                if (!token || targetByToken.has(token)) return;
                targetByToken.set(token, column);
            });

            compareSharedColumns = compareSourceSchema
                .map((sourceColumn) => {
                    const token = normalizeColumnToken(sourceColumn.name);
                    const targetColumn = targetByToken.get(token);
                    if (!token || !targetColumn) return null;
                    return {
                        token,
                        sourceName: sourceColumn.name,
                        targetName: targetColumn.name,
                        sourceType: sourceColumn.column_type || sourceColumn.data_type || '-',
                        targetType: targetColumn.column_type || targetColumn.data_type || '-'
                    };
                })
                .filter(Boolean);

            const sharedSet = new Set(compareSharedColumns.map((column) => column.token));
            const sourcePkTokens = uniqueTokens(
                (Array.isArray(sourcePks) ? sourcePks : [])
                    .map((pk) => pk.columnName || pk.column_name)
            );
            const targetPkSet = new Set(uniqueTokens(
                (Array.isArray(targetPks) ? targetPks : [])
                    .map((pk) => pk.columnName || pk.column_name)
            ));
            compareSharedPkColumns = sourcePkTokens.filter((token) => sharedSet.has(token) && targetPkSet.has(token));

            const keptKeys = orderTokensBySharedColumns(compareSelectedKeyColumns);
            compareSelectedKeyColumns = keptKeys.length > 0
                ? keptKeys
                : orderTokensBySharedColumns(compareSharedPkColumns);

            const keySet = new Set(compareSelectedKeyColumns);
            const keptCompare = orderTokensBySharedColumns(
                compareSelectedCompareColumns.filter((token) => !keySet.has(token))
            );
            compareSelectedCompareColumns = keptCompare.length > 0
                ? keptCompare
                : orderTokensBySharedColumns(
                    compareSharedColumns
                        .map((column) => column.token)
                        .filter((token) => !keySet.has(token))
                );
        } catch (error) {
            resetCompareColumnState();
            console.error('Failed to load compare metadata:', error);
        } finally {
            render();
        }
    };

    const setCompareKeyColumn = (columnToken, checked) => {
        const token = normalizeColumnToken(columnToken);
        if (!token) return;

        let nextKeys = checked
            ? [...compareSelectedKeyColumns, token]
            : compareSelectedKeyColumns.filter((item) => item !== token);
        nextKeys = orderTokensBySharedColumns(nextKeys);
        compareSelectedKeyColumns = nextKeys;

        if (checked) {
            compareSelectedCompareColumns = compareSelectedCompareColumns.filter((item) => item !== token);
        }
        compareSelectedCompareColumns = orderTokensBySharedColumns(compareSelectedCompareColumns);
    };

    const setCompareCompareColumn = (columnToken, checked) => {
        const token = normalizeColumnToken(columnToken);
        if (!token) return;
        if (compareSelectedKeyColumns.includes(token)) return;

        const nextCompare = checked
            ? [...compareSelectedCompareColumns, token]
            : compareSelectedCompareColumns.filter((item) => item !== token);
        compareSelectedCompareColumns = orderTokensBySharedColumns(nextCompare);
    };

    const buildComparePayload = () => {
        const keyColumns = compareSelectedKeyColumns.map(tokenToSourceColumnName);
        const compareColumns = compareSelectedCompareColumns.map(tokenToSourceColumnName);
        return {
            sourceDatabase: compareSourceDb,
            sourceTable: compareSourceTable,
            targetDatabase: compareTargetDb,
            targetTable: compareTargetTable,
            keyColumns,
            compareColumns,
            sampleLimit: ensurePositiveInt(compareSettings.sampleLimit, 50),
            maxRows: ensurePositiveInt(compareSettings.maxRows, 20000),
            includeInserts: !!compareSettings.includeInserts,
            includeUpdates: !!compareSettings.includeUpdates,
            includeDeletes: !!compareSettings.includeDeletes,
            wrapInTransaction: !!compareSettings.wrapInTransaction,
            statementLimit: ensurePositiveInt(compareSettings.statementLimit, 10000)
        };
    };

    const ensureCompareReady = () => {
        if (!compareSourceDb || !compareSourceTable || !compareTargetDb || !compareTargetTable) {
            Dialog.alert('Please select source and target database/table.', 'Selection Required');
            return false;
        }
        if (compareSelectedKeyColumns.length === 0) {
            Dialog.alert('Please select at least one key column.', 'Selection Required');
            return false;
        }
        return true;
    };

    const handleCompareRun = async () => {
        if (!ensureCompareReady()) return;
        resetCompareOutputs();
        isProcessing = true;
        render();

        try {
            compareResult = await DataCompareApi.compareTableData(buildComparePayload());
        } catch (error) {
            compareError = String(error || 'Data compare failed');
            Dialog.alert(`Data compare failed: ${compareError}`, 'Data Compare');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleCompareGenerateScript = async () => {
        if (!ensureCompareReady()) return;
        if (!compareResult) {
            const shouldRun = await Dialog.confirm(
                'Compare result is empty. Run compare first?',
                'Data Compare'
            );
            if (shouldRun) {
                await handleCompareRun();
            }
            if (!compareResult) return;
        }

        isProcessing = true;
        render();

        try {
            comparePlan = await DataCompareApi.generateDataSyncScript(buildComparePayload());
        } catch (error) {
            compareError = String(error || 'Sync script generation failed');
            Dialog.alert(`Sync script generation failed: ${compareError}`, 'Data Compare');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const TRANSFER_ACTIVE_STATUSES = new Set(['queued', 'running']);
    const TRANSFER_TERMINAL_STATUSES = new Set(['success', 'failed', 'cancelled']);

    const normalizeTransferStatus = (value) => String(value || '').trim().toLowerCase();

    const isTransferRunActive = (run) => TRANSFER_ACTIVE_STATUSES.has(normalizeTransferStatus(run?.status));

    const isTransferRunTerminal = (run) => TRANSFER_TERMINAL_STATUSES.has(normalizeTransferStatus(run?.status));

    const formatTransferTime = (value) => {
        if (!value) return '-';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return parsed.toLocaleString();
    };

    const parseCommaSeparatedList = (value) => {
        const seen = new Set();
        const out = [];
        String(value || '')
            .split(',')
            .map((item) => item.trim())
            .forEach((item) => {
                if (!item) return;
                const token = item.toLowerCase();
                if (seen.has(token)) return;
                seen.add(token);
                out.push(item);
            });
        return out;
    };

    const resetTransferPlanArtifacts = () => {
        transferPlanPreview = null;
        transferTaskPayload = null;
        transferError = '';
        transferMappingValidationMessage = '';
    };

    const stopTransferStatusPolling = () => {
        if (transferStatusPollInterval) {
            clearInterval(transferStatusPollInterval);
            transferStatusPollInterval = null;
        }
    };

    const upsertTransferRun = (run) => {
        if (!run?.operationId) return;
        const index = transferRunHistory.findIndex((item) => item.operationId === run.operationId);
        if (index >= 0) {
            transferRunHistory[index] = run;
        } else {
            transferRunHistory.unshift(run);
        }
        transferRunHistory.sort((a, b) => {
            const aTs = Date.parse(a.startedAt || a.updatedAt || 0);
            const bTs = Date.parse(b.startedAt || b.updatedAt || 0);
            return bTs - aTs;
        });
        transferRunHistory = transferRunHistory.slice(0, 40);
    };

    const setTransferActiveRun = (run) => {
        transferActiveRun = run || null;
        transferActiveOperationId = run?.operationId || null;
        if (run && isTransferRunActive(run)) {
            startTransferStatusPolling(run.operationId);
        } else {
            stopTransferStatusPolling();
        }
    };

    const pollTransferRunStatus = async (operationId) => {
        if (!operationId) return;
        try {
            const status = await DataTransferApi.getStatus(operationId);
            upsertTransferRun(status);
            if (transferActiveOperationId === operationId) {
                transferActiveRun = status;
            }
            if (isTransferRunTerminal(status)) {
                stopTransferStatusPolling();
            }
            if (activeTab === 'transfer') {
                render();
            }
        } catch (error) {
            stopTransferStatusPolling();
            transferError = String(error || 'Failed to fetch transfer status');
            if (activeTab === 'transfer') {
                render();
            }
        }
    };

    const startTransferStatusPolling = (operationId) => {
        stopTransferStatusPolling();
        pollTransferRunStatus(operationId);
        transferStatusPollInterval = setInterval(() => {
            pollTransferRunStatus(operationId);
        }, 1200);
    };

    const transferConnectionLabel = (connectionId) => {
        const item = transferConnections.find((conn) => conn.id === connectionId);
        return item?.label || connectionId || '-';
    };

    const loadTransferConnections = async () => {
        try {
            const rows = await invoke('load_connections');
            const normalized = (Array.isArray(rows) ? rows : [])
                .map((conn, idx) => {
                    const id = String(conn?.id || '').trim();
                    const name = String(conn?.name || '').trim();
                    const host = String(conn?.host || '').trim();
                    const port = Number.parseInt(String(conn?.port || ''), 10);
                    const dbType = String(conn?.dbType || conn?.db_type || '').trim();
                    if (!id) return null;

                    const hostLabel = host
                        ? `${host}${Number.isFinite(port) && port > 0 ? `:${port}` : ''}`
                        : `connection-${idx + 1}`;
                    const baseLabel = name || hostLabel;
                    const typeLabel = dbType ? ` (${dbType.toUpperCase()})` : '';
                    return {
                        id,
                        label: `${baseLabel}${typeLabel}`
                    };
                })
                .filter(Boolean);

            transferConnections = normalized;

            if (transferSourceConnectionId && !normalized.some((item) => item.id === transferSourceConnectionId)) {
                transferSourceConnectionId = '';
            }
            if (transferTargetConnectionId && !normalized.some((item) => item.id === transferTargetConnectionId)) {
                transferTargetConnectionId = '';
            }

            if (!transferSourceConnectionId && normalized.length > 0) {
                transferSourceConnectionId = normalized[0].id;
            }
            if (!transferTargetConnectionId && normalized.length > 0) {
                transferTargetConnectionId = normalized[Math.min(1, normalized.length - 1)].id;
            }
        } catch (error) {
            console.error('Failed to load transfer connections:', error);
            transferConnections = [];
        } finally {
            if (activeTab === 'transfer') {
                render();
            }
        }
    };

    const loadTransferRunHistory = async () => {
        try {
            const rows = await DataTransferApi.listRuns(40);
            transferRunHistory = Array.isArray(rows) ? rows : [];

            if (transferActiveOperationId) {
                const active = transferRunHistory.find((run) => run.operationId === transferActiveOperationId);
                if (active) {
                    transferActiveRun = active;
                    if (isTransferRunActive(active)) {
                        startTransferStatusPolling(active.operationId);
                    } else {
                        stopTransferStatusPolling();
                    }
                }
            }
        } catch (error) {
            transferError = String(error || 'Failed to load transfer runs');
        } finally {
            if (activeTab === 'transfer') {
                render();
            }
        }
    };

    const buildTransferPlanRequest = () => ({
        sourceConnectionId: String(transferSourceConnectionId || '').trim(),
        targetConnectionId: String(transferTargetConnectionId || '').trim(),
        sourceDatabase: String(transferSourceDatabase || '').trim(),
        targetDatabase: String(transferTargetDatabase || '').trim(),
        includeSchemaMigration: !!transferIncludeSchemaMigration,
        lockGuard: !!transferLockGuard,
        mappingProfile: String(transferMappingProfile || '').trim() || null,
        objects: transferObjects.map((item) => ({
            sourceTable: item.sourceTable,
            targetTable: item.targetTable,
            mode: item.mode,
            keyColumns: item.keyColumns,
            sinkType: item.sinkType || 'database',
            sinkPath: item.sinkPath || null
        }))
    });

    const ensureTransferReady = () => {
        if (!String(transferSourceConnectionId || '').trim()) {
            Dialog.alert('Please select source connection.', 'Selection Required');
            return false;
        }
        if (!String(transferTargetConnectionId || '').trim()) {
            Dialog.alert('Please select target connection.', 'Selection Required');
            return false;
        }
        if (!String(transferSourceDatabase || '').trim()) {
            Dialog.alert('Please enter source database/schema.', 'Selection Required');
            return false;
        }
        if (!String(transferTargetDatabase || '').trim()) {
            Dialog.alert('Please enter target database/schema.', 'Selection Required');
            return false;
        }
        if (!Array.isArray(transferObjects) || transferObjects.length === 0) {
            Dialog.alert('Please add at least one transfer object.', 'Selection Required');
            return false;
        }
        return true;
    };

    const handleTransferAddObject = () => {
        const sourceTable = String(transferDraftSourceTable || '').trim();
        const targetTable = String(transferDraftTargetTable || '').trim() || sourceTable;
        const mode = ['append', 'replace', 'upsert'].includes(transferDraftMode)
            ? transferDraftMode
            : 'append';
        const sinkType = ['database', 'csv', 'jsonl', 'sql'].includes(transferDraftSinkType)
            ? transferDraftSinkType
            : 'database';
        const sinkPath = String(transferDraftSinkPath || '').trim();
        const keyColumns = parseCommaSeparatedList(transferDraftKeyColumns);

        if (!sourceTable) {
            Dialog.alert('Source table is required.', 'Transfer Object');
            return;
        }
        if (sinkType !== 'database' && !sinkPath) {
            Dialog.alert('Sink path is required for CSV/JSONL/SQL sinks.', 'Transfer Object');
            return;
        }
        if (mode === 'upsert' && !['database', 'sql'].includes(sinkType)) {
            Dialog.alert('Upsert mode is only valid for database/sql sinks.', 'Transfer Object');
            return;
        }
        if (mode === 'upsert' && keyColumns.length === 0) {
            Dialog.alert('Upsert mode requires at least one key column.', 'Transfer Object');
            return;
        }

        transferObjects.push({
            sourceTable,
            targetTable,
            mode,
            keyColumns,
            sinkType,
            sinkPath: sinkType === 'database' ? null : sinkPath
        });
        transferDraftSourceTable = '';
        transferDraftTargetTable = '';
        transferDraftKeyColumns = '';
        transferDraftSinkType = 'database';
        transferDraftSinkPath = '';
        resetTransferPlanArtifacts();
        render();
    };

    const handleTransferRemoveObject = (index) => {
        if (index < 0 || index >= transferObjects.length) return;
        transferObjects.splice(index, 1);
        resetTransferPlanArtifacts();
        render();
    };

    const handleTransferPreviewPlan = async () => {
        if (!ensureTransferReady()) return;
        resetTransferPlanArtifacts();
        isProcessing = true;
        render();

        try {
            transferPlanPreview = await DataTransferApi.previewPlan(buildTransferPlanRequest());
        } catch (error) {
            transferError = String(error || 'Transfer plan preview failed');
            Dialog.alert(`Transfer plan preview failed: ${transferError}`, 'Data Transfer');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleTransferStart = async () => {
        if (!ensureTransferReady()) return;

        if (transferObjects.some((item) => item.mode === 'replace')) {
            const confirmedReplace = await Dialog.confirm(
                'Replace mode will overwrite target table data. Continue?',
                'Replace Mode Warning'
            );
            if (!confirmedReplace) return;
        }

        const plan = buildTransferPlanRequest();
        const confirmed = await Dialog.confirm(
            `${transferDryRun ? 'Start dry run' : 'Start transfer'} for ${plan.objects.length} object(s)?`,
            'Start Data Transfer'
        );
        if (!confirmed) return;

        isProcessing = true;
        transferError = '';
        render();

        try {
            const status = await DataTransferApi.startTransfer({
                plan,
                dryRun: !!transferDryRun
            });
            upsertTransferRun(status);
            setTransferActiveRun(status);
            await loadTransferRunHistory();
        } catch (error) {
            transferError = String(error || 'Failed to start transfer');
            Dialog.alert(`Failed to start transfer: ${transferError}`, 'Data Transfer');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleTransferCancel = async () => {
        if (!transferActiveRun || !isTransferRunActive(transferActiveRun)) {
            Dialog.alert('No active transfer run to cancel.', 'Data Transfer');
            return;
        }
        const confirmed = await Dialog.confirm(
            `Cancel transfer operation ${transferActiveRun.operationId}?`,
            'Cancel Transfer'
        );
        if (!confirmed) return;

        try {
            const status = await DataTransferApi.cancelTransfer(transferActiveRun.operationId);
            upsertTransferRun(status);
            setTransferActiveRun(status);
            await loadTransferRunHistory();
            render();
        } catch (error) {
            transferError = String(error || 'Failed to cancel transfer');
            Dialog.alert(`Failed to cancel transfer: ${transferError}`, 'Data Transfer');
            render();
        }
    };

    const handleTransferGenerateTaskPayload = async () => {
        if (!ensureTransferReady()) return;
        isProcessing = true;
        transferError = '';
        render();

        try {
            transferTaskPayload = await DataTransferApi.generateTaskPayload(buildTransferPlanRequest());
        } catch (error) {
            transferError = String(error || 'Failed to generate transfer task payload');
            Dialog.alert(`Failed to generate transfer task payload: ${transferError}`, 'Data Transfer');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleTransferValidateMappingRule = async () => {
        const sourceColumn = String(transferMappingSourceColumn || '').trim();
        const targetColumn = String(transferMappingTargetColumn || '').trim();
        const castType = String(transferMappingCastType || '').trim();

        if (!sourceColumn || !targetColumn) {
            Dialog.alert('Please provide both source and target column names.', 'Mapping Validation');
            return;
        }

        isProcessing = true;
        transferMappingValidationMessage = '';
        transferError = '';
        render();

        try {
            const message = await DataTransferApi.validateMapping([
                {
                    sourceColumn,
                    targetColumn,
                    castType: castType || null
                }
            ]);
            transferMappingValidationMessage = message;
        } catch (error) {
            transferError = String(error || 'Mapping validation failed');
            Dialog.alert(`Mapping validation failed: ${transferError}`, 'Data Transfer');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const selectTransferRun = async (operationId) => {
        const opId = String(operationId || '').trim();
        if (!opId) return;
        try {
            const status = await DataTransferApi.getStatus(opId);
            upsertTransferRun(status);
            setTransferActiveRun(status);
            render();
        } catch (error) {
            transferError = String(error || 'Failed to load transfer run');
            Dialog.alert(`Failed to load transfer run: ${transferError}`, 'Data Transfer');
            render();
        }
    };

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
                            <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Import, Export, Transfer, Backup & Mock Data</p>
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
                    <button id="tab-compare" class="px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'compare' ? (isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg' : 'bg-mysql-teal text-white shadow-lg') : (isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#575279] hover:text-[#286983]' : 'text-gray-400 hover:text-white'))}">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">compare_arrows</span>
                        Compare
                    </button>
                    <button id="tab-transfer" class="px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'transfer' ? (isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg' : 'bg-mysql-teal text-white shadow-lg') : (isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#575279] hover:text-[#286983]' : 'text-gray-400 hover:text-white'))}">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">sync_alt</span>
                        Transfer
                    </button>
                </div>

                <!-- Selection Panel -->
                ${activeTab === 'compare' || activeTab === 'transfer' ? '' : `
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
                `}

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

        if (activeTab === 'compare') {
            const dbOptions = (placeholder, selectedValue) => `
                <option value="">${placeholder}</option>
                ${databases.map((db) => `<option value="${escapeHtml(db)}" ${selectedValue === db ? 'selected' : ''}>${escapeHtml(db)}</option>`).join('')}
            `;
            const sourceTableOptions = `
                <option value="">Select source table</option>
                ${compareSourceTables.map((table) => `<option value="${escapeHtml(table)}" ${compareSourceTable === table ? 'selected' : ''}>${escapeHtml(table)}</option>`).join('')}
            `;
            const targetTableOptions = `
                <option value="">Select target table</option>
                ${compareTargetTables.map((table) => `<option value="${escapeHtml(table)}" ${compareTargetTable === table ? 'selected' : ''}>${escapeHtml(table)}</option>`).join('')}
            `;
            const summary = compareResult?.summary || null;
            const sampleRows = Array.isArray(compareResult?.samples)
                ? compareResult.samples.map((sample, idx) => {
                    const diffType = sample.diffType || sample.diff_type || '-';
                    const keyJson = JSON.stringify(sample.key || {}, null, 0);
                    const changedCols = Array.isArray(sample.changedColumns || sample.changed_columns)
                        ? (sample.changedColumns || sample.changed_columns).join(', ')
                        : '-';
                    return `
                        <tr class="${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} border-b last:border-b-0">
                            <td class="px-2 py-2 text-[11px] font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${idx + 1}</td>
                            <td class="px-2 py-2 text-[11px] font-semibold ${diffType === 'changed' ? (isDawn ? 'text-[#ea9d34]' : 'text-amber-400') : (diffType === 'missing_in_target' ? (isDawn ? 'text-[#286983]' : 'text-emerald-400') : (isDawn ? 'text-[#b4637a]' : 'text-red-400'))}">${escapeHtml(diffType)}</td>
                            <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')} font-mono">${escapeHtml(keyJson)}</td>
                            <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')}">${escapeHtml(changedCols || '-')}</td>
                        </tr>
                    `;
                }).join('')
                : '';
            const compareWarnings = Array.isArray(compareResult?.warnings) ? compareResult.warnings : [];
            const planWarnings = Array.isArray(comparePlan?.warnings) ? comparePlan.warnings : [];
            const combinedWarnings = [...compareWarnings, ...planWarnings];
            const selectedKeySet = new Set(compareSelectedKeyColumns);
            const selectedCompareSet = new Set(compareSelectedCompareColumns);
            const columnSelectionRows = compareSharedColumns.map((column, idx) => {
                const isKey = selectedKeySet.has(column.token);
                const isCompare = selectedCompareSet.has(column.token);
                return `
                    <tr class="${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} border-b last:border-b-0">
                        <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${idx + 1}</td>
                        <td class="px-2 py-2 text-[11px] font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${escapeHtml(column.sourceName)}</td>
                        <td class="px-2 py-2 text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">${escapeHtml(column.sourceType)}</td>
                        <td class="px-2 py-2 text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">${escapeHtml(column.targetType)}</td>
                        <td class="px-2 py-2 text-center">
                            <input type="checkbox" class="compare-key-checkbox w-4 h-4" data-column-token="${escapeHtml(column.token)}" ${isKey ? 'checked' : ''} />
                        </td>
                        <td class="px-2 py-2 text-center">
                            <input type="checkbox" class="compare-column-checkbox w-4 h-4" data-column-token="${escapeHtml(column.token)}" ${isCompare ? 'checked' : ''} ${isKey ? 'disabled' : ''} />
                        </td>
                    </tr>
                `;
            }).join('');

            return `
                <div class="space-y-5">
                    <div>
                        <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-2">Data Compare & Sync</h3>
                        <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                            Compare source and target tables by key columns, then generate sync SQL script safely.
                        </p>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/10 bg-white/5'))} p-4 space-y-3">
                            <div class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Source</div>
                            <select id="compare-source-db" class="w-full tactile-input text-sm py-1.5">
                                ${dbOptions('Select source database', compareSourceDb)}
                            </select>
                            <select id="compare-source-table" class="w-full tactile-input text-sm py-1.5" ${!compareSourceDb ? 'disabled' : ''}>
                                ${sourceTableOptions}
                            </select>
                        </div>
                        <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/10 bg-white/5'))} p-4 space-y-3">
                            <div class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Target</div>
                            <select id="compare-target-db" class="w-full tactile-input text-sm py-1.5">
                                ${dbOptions('Select target database', compareTargetDb)}
                            </select>
                            <select id="compare-target-table" class="w-full tactile-input text-sm py-1.5" ${!compareTargetDb ? 'disabled' : ''}>
                                ${targetTableOptions}
                            </select>
                        </div>
                    </div>

                    <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} overflow-hidden">
                        <div class="px-3 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">
                            <span>Column Selection</span>
                            <div class="flex items-center gap-2">
                                <button id="compare-use-pk-btn" class="px-2 py-1 rounded text-[10px] font-bold ${isDawn ? 'bg-[#31748f] text-white' : 'bg-mysql-teal text-white'} hover:brightness-110 transition-all">Use Shared PK</button>
                                <button id="compare-select-all-cols-btn" class="px-2 py-1 rounded text-[10px] font-bold ${isDawn ? 'bg-[#ea9d34] text-[#fffaf3]' : 'bg-blue-500 text-white'} hover:brightness-110 transition-all">All Compare</button>
                                <button id="compare-clear-cols-btn" class="px-2 py-1 rounded text-[10px] font-bold ${isDawn ? 'bg-[#b4637a] text-white' : 'bg-gray-500 text-white'} hover:brightness-110 transition-all">Clear Compare</button>
                            </div>
                        </div>
                        <div class="px-3 py-2 text-[11px] ${isLight ? 'text-gray-600 bg-gray-50' : (isDawn ? 'text-[#797593] bg-[#faf4ed]' : 'text-gray-300 bg-black/20')}">
                            Key: <b>${compareSelectedKeyColumns.map(tokenToSourceColumnName).map(escapeHtml).join(', ') || '-'}</b> | Compare: <b>${compareSelectedCompareColumns.map(tokenToSourceColumnName).map(escapeHtml).join(', ') || '-'}</b>
                        </div>
                        <div class="max-h-[260px] overflow-auto custom-scrollbar">
                            <table class="w-full">
                                <thead class="${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">
                                    <tr>
                                        <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">#</th>
                                        <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Column</th>
                                        <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Source Type</th>
                                        <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Target Type</th>
                                        <th class="px-2 py-2 text-center text-[10px] uppercase tracking-widest">Key</th>
                                        <th class="px-2 py-2 text-center text-[10px] uppercase tracking-widest">Compare</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${columnSelectionRows || `
                                        <tr>
                                            <td colspan="6" class="px-3 py-3 text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                                                Select source/target tables to load shared columns.
                                            </td>
                                        </tr>
                                    `}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="grid grid-cols-4 gap-4">
                        <div>
                            <label class="block text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Sample Limit</label>
                            <input id="compare-sample-limit" type="number" min="1" max="500" value="${compareSettings.sampleLimit}" class="w-full tactile-input text-sm py-1.5" />
                        </div>
                        <div>
                            <label class="block text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Max Rows</label>
                            <input id="compare-max-rows" type="number" min="1" max="500000" value="${compareSettings.maxRows}" class="w-full tactile-input text-sm py-1.5" />
                        </div>
                        <div>
                            <label class="block text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Statement Limit</label>
                            <input id="compare-statement-limit" type="number" min="1" max="200000" value="${compareSettings.statementLimit}" class="w-full tactile-input text-sm py-1.5" />
                        </div>
                        <div class="flex items-end">
                            <div class="w-full flex gap-2">
                                <button id="compare-run-btn" class="flex-1 px-3 py-2 rounded-lg text-xs font-bold ${isDawn ? 'bg-[#31748f] text-white hover:brightness-110' : 'bg-mysql-teal text-white hover:brightness-110'} transition-all">Compare</button>
                                <button id="compare-script-btn" class="flex-1 px-3 py-2 rounded-lg text-xs font-bold ${isDawn ? 'bg-[#ea9d34] text-[#fffaf3] hover:brightness-110' : 'bg-emerald-500 text-white hover:brightness-110'} transition-all">Generate SQL</button>
                            </div>
                        </div>
                    </div>

                    <div class="flex flex-wrap gap-4">
                        <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                            <input id="compare-include-inserts" type="checkbox" class="w-4 h-4" ${compareSettings.includeInserts ? 'checked' : ''} />
                            Include INSERT
                        </label>
                        <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                            <input id="compare-include-updates" type="checkbox" class="w-4 h-4" ${compareSettings.includeUpdates ? 'checked' : ''} />
                            Include UPDATE
                        </label>
                        <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                            <input id="compare-include-deletes" type="checkbox" class="w-4 h-4" ${compareSettings.includeDeletes ? 'checked' : ''} />
                            Include DELETE
                        </label>
                        <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                            <input id="compare-wrap-tx" type="checkbox" class="w-4 h-4" ${compareSettings.wrapInTransaction ? 'checked' : ''} />
                            Wrap in transaction
                        </label>
                    </div>

                    ${compareError ? `
                        <div class="rounded-lg border ${isLight ? 'border-red-200 bg-red-50 text-red-700' : (isDawn ? 'border-[#b4637a]/40 bg-[#b4637a]/10 text-[#b4637a]' : 'border-red-400/30 bg-red-500/10 text-red-400')} px-3 py-2 text-sm">
                            ${escapeHtml(compareError)}
                        </div>
                    ` : ''}

                    ${combinedWarnings.length > 0 ? `
                        <div class="rounded-lg border ${isLight ? 'border-amber-200 bg-amber-50 text-amber-700' : (isDawn ? 'border-[#ea9d34]/40 bg-[#ea9d34]/10 text-[#ea9d34]' : 'border-amber-400/30 bg-amber-500/10 text-amber-300')} px-3 py-2 text-xs">
                            ${combinedWarnings.map((warning) => `<div>• ${escapeHtml(warning)}</div>`).join('')}
                        </div>
                    ` : ''}

                    ${summary ? `
                        <div class="grid grid-cols-6 gap-3">
                            <div class="rounded-lg p-3 ${isLight ? 'bg-gray-50 border border-gray-200' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                                <div class="text-[10px] uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Source</div>
                                <div class="text-lg font-bold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')}">${summary.sourceRows}</div>
                            </div>
                            <div class="rounded-lg p-3 ${isLight ? 'bg-gray-50 border border-gray-200' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1]' : 'bg-white/5 border border-white/10')}">
                                <div class="text-[10px] uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Target</div>
                                <div class="text-lg font-bold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')}">${summary.targetRows}</div>
                            </div>
                            <div class="rounded-lg p-3 ${isLight ? 'bg-emerald-50 border border-emerald-200' : (isDawn ? 'bg-[#286983]/10 border border-[#286983]/30' : 'bg-emerald-500/10 border border-emerald-400/30')}">
                                <div class="text-[10px] uppercase tracking-widest ${isLight ? 'text-emerald-700' : (isDawn ? 'text-[#286983]' : 'text-emerald-300')}">Missing</div>
                                <div class="text-lg font-bold ${isLight ? 'text-emerald-700' : (isDawn ? 'text-[#286983]' : 'text-emerald-300')}">${summary.missingInTarget}</div>
                            </div>
                            <div class="rounded-lg p-3 ${isLight ? 'bg-red-50 border border-red-200' : (isDawn ? 'bg-[#b4637a]/10 border border-[#b4637a]/30' : 'bg-red-500/10 border border-red-400/30')}">
                                <div class="text-[10px] uppercase tracking-widest ${isLight ? 'text-red-700' : (isDawn ? 'text-[#b4637a]' : 'text-red-300')}">Extra</div>
                                <div class="text-lg font-bold ${isLight ? 'text-red-700' : (isDawn ? 'text-[#b4637a]' : 'text-red-300')}">${summary.extraInTarget}</div>
                            </div>
                            <div class="rounded-lg p-3 ${isLight ? 'bg-amber-50 border border-amber-200' : (isDawn ? 'bg-[#ea9d34]/10 border border-[#ea9d34]/30' : 'bg-amber-500/10 border border-amber-400/30')}">
                                <div class="text-[10px] uppercase tracking-widest ${isLight ? 'text-amber-700' : (isDawn ? 'text-[#ea9d34]' : 'text-amber-300')}">Changed</div>
                                <div class="text-lg font-bold ${isLight ? 'text-amber-700' : (isDawn ? 'text-[#ea9d34]' : 'text-amber-300')}">${summary.changed}</div>
                            </div>
                            <div class="rounded-lg p-3 ${isLight ? 'bg-blue-50 border border-blue-200' : (isDawn ? 'bg-[#31748f]/10 border border-[#31748f]/30' : 'bg-blue-500/10 border border-blue-400/30')}">
                                <div class="text-[10px] uppercase tracking-widest ${isLight ? 'text-blue-700' : (isDawn ? 'text-[#31748f]' : 'text-blue-300')}">Unchanged</div>
                                <div class="text-lg font-bold ${isLight ? 'text-blue-700' : (isDawn ? 'text-[#31748f]' : 'text-blue-300')}">${summary.unchanged}</div>
                            </div>
                        </div>

                        <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} overflow-hidden">
                            <div class="px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">Sample Diffs</div>
                            <div class="max-h-[260px] overflow-auto custom-scrollbar">
                                <table class="w-full">
                                    <thead class="${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">
                                        <tr>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">#</th>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Type</th>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Key</th>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Changed Columns</th>
                                        </tr>
                                    </thead>
                                    <tbody>${sampleRows || ''}</tbody>
                                </table>
                            </div>
                        </div>
                    ` : ''}

                    ${comparePlan ? `
                        <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} overflow-hidden">
                            <div class="px-3 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">
                                <span>Sync Script</span>
                                <div class="flex items-center gap-2">
                                    <span class="${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Statements: ${comparePlan.statementCounts?.total ?? comparePlan.statement_counts?.total ?? 0}</span>
                                    <button id="compare-copy-script-btn" class="px-2 py-1 rounded text-[10px] font-bold ${isDawn ? 'bg-[#31748f] text-white' : 'bg-mysql-teal text-white'} hover:brightness-110 transition-all">Copy</button>
                                </div>
                            </div>
                            <pre class="p-3 text-[11px] leading-relaxed ${isLight ? 'text-gray-700 bg-white' : (isDawn ? 'text-[#575279] bg-[#fffaf3]' : 'text-gray-300 bg-black/20')} max-h-[360px] overflow-auto custom-scrollbar">${escapeHtml(comparePlan.script || '')}</pre>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        if (activeTab === 'transfer') {
            const connectionOptions = (placeholder, selectedValue) => `
                <option value="">${placeholder}</option>
                ${transferConnections.map((conn) => `<option value="${escapeHtml(conn.id)}" ${selectedValue === conn.id ? 'selected' : ''}>${escapeHtml(conn.label)}</option>`).join('')}
            `;

            const objectRows = transferObjects
                .map((item, idx) => {
                    const keyColumns = Array.isArray(item.keyColumns) && item.keyColumns.length > 0
                        ? item.keyColumns.join(', ')
                        : '-';
                    const sinkType = String(item.sinkType || 'database').trim().toLowerCase() || 'database';
                    const sinkPath = sinkType === 'database'
                        ? '-'
                        : (String(item.sinkPath || '').trim() || '-');
                    return `
                        <tr class="${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} border-b last:border-b-0">
                            <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${idx + 1}</td>
                            <td class="px-2 py-2 text-[11px] font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${escapeHtml(item.sourceTable)}</td>
                            <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')}">${escapeHtml(item.targetTable)}</td>
                            <td class="px-2 py-2 text-[10px] uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">${escapeHtml(item.mode)}</td>
                            <td class="px-2 py-2 text-[10px] uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">${escapeHtml(sinkType)}</td>
                            <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')}">${escapeHtml(sinkPath)}</td>
                            <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')}">${escapeHtml(keyColumns)}</td>
                            <td class="px-2 py-2 text-right">
                                <button class="transfer-remove-object-btn px-2 py-1 rounded text-[10px] font-bold ${isDawn ? 'bg-[#b4637a] text-white' : 'bg-red-500 text-white'} hover:brightness-110 transition-all" data-transfer-index="${idx}">
                                    Remove
                                </button>
                            </td>
                        </tr>
                    `;
                })
                .join('');

            const transferWarnings = Array.isArray(transferPlanPreview?.warnings)
                ? transferPlanPreview.warnings
                : [];
            const transferSchemaPreflight =
                transferPlanPreview?.schemaMigrationPreflight
                    && typeof transferPlanPreview.schemaMigrationPreflight === 'object'
                    ? transferPlanPreview.schemaMigrationPreflight
                    : null;
            const transferSchemaPreflightStatus = String(transferSchemaPreflight?.status || '')
                .trim()
                .toLowerCase();
            const transferSchemaPreflightWarnings = Array.isArray(transferSchemaPreflight?.warnings)
                ? transferSchemaPreflight.warnings
                : [];
            const activeRun = transferActiveRun;
            const activeRunStatus = normalizeTransferStatus(activeRun?.status || '-');
            const activeRunProgress = Math.max(0, Math.min(100, Number(activeRun?.progressPct || 0)));
            const activeRunStatusClass = activeRunStatus === 'success'
                ? (isDawn ? 'text-[#286983]' : 'text-emerald-500')
                : activeRunStatus === 'failed'
                    ? (isDawn ? 'text-[#b4637a]' : 'text-red-500')
                    : activeRunStatus === 'cancelled'
                        ? (isDawn ? 'text-[#ea9d34]' : 'text-amber-500')
                        : (isDawn ? 'text-[#31748f]' : 'text-mysql-teal');
            const canCancelActiveRun = !!activeRun && isTransferRunActive(activeRun);

            const historyRows = transferRunHistory.slice(0, 12).map((run, idx) => {
                const status = normalizeTransferStatus(run.status || '');
                const statusClass = status === 'success'
                    ? (isDawn ? 'text-[#286983]' : 'text-emerald-500')
                    : status === 'failed'
                        ? (isDawn ? 'text-[#b4637a]' : 'text-red-500')
                        : status === 'cancelled'
                            ? (isDawn ? 'text-[#ea9d34]' : 'text-amber-500')
                            : (isDawn ? 'text-[#31748f]' : 'text-mysql-teal');
                return `
                    <tr class="${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} border-b last:border-b-0">
                        <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">${idx + 1}</td>
                        <td class="px-2 py-2 text-[11px] font-semibold ${statusClass}">${escapeHtml(status)}</td>
                        <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')}">${escapeHtml(run.sourceDatabase)} -> ${escapeHtml(run.targetDatabase)}</td>
                        <td class="px-2 py-2 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')}">${run.processedObjects || 0}/${run.objectCount || 0}</td>
                        <td class="px-2 py-2 text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">${escapeHtml(formatTransferTime(run.startedAt))}</td>
                        <td class="px-2 py-2 text-right">
                            <button class="transfer-select-run-btn px-2 py-1 rounded text-[10px] font-bold ${isDawn ? 'bg-[#31748f] text-white' : 'bg-mysql-teal text-white'} hover:brightness-110 transition-all" data-operation-id="${escapeHtml(run.operationId)}">
                                Open
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            return `
                <div class="space-y-5">
                    <div>
                        <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-2">Data Transfer / Migration</h3>
                        <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                            Plan and run DB-to-DB or file-sink transfers with object-level mode control, dry-run support, and live run monitoring.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/10 bg-white/5'))} p-4 space-y-3">
                            <div class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Source</div>
                            <select id="transfer-source-connection" class="w-full tactile-input text-sm py-1.5">
                                ${connectionOptions('Select source connection', transferSourceConnectionId)}
                            </select>
                            <input id="transfer-source-db" type="text" value="${escapeHtml(transferSourceDatabase)}" class="w-full tactile-input text-sm py-1.5" placeholder="Source database/schema" />
                            <div class="text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">
                                Selected: ${escapeHtml(transferConnectionLabel(transferSourceConnectionId))}
                            </div>
                        </div>

                        <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-bg' : 'border-white/10 bg-white/5'))} p-4 space-y-3">
                            <div class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Target</div>
                            <select id="transfer-target-connection" class="w-full tactile-input text-sm py-1.5">
                                ${connectionOptions('Select target connection', transferTargetConnectionId)}
                            </select>
                            <input id="transfer-target-db" type="text" value="${escapeHtml(transferTargetDatabase)}" class="w-full tactile-input text-sm py-1.5" placeholder="Target database/schema" />
                            <div class="text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">
                                Selected: ${escapeHtml(transferConnectionLabel(transferTargetConnectionId))}
                            </div>
                        </div>
                    </div>

                    <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} overflow-hidden">
                        <div class="px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">Transfer Objects</div>
                        <div class="p-3 space-y-3">
                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
                                <input id="transfer-draft-source-table" type="text" value="${escapeHtml(transferDraftSourceTable)}" class="w-full tactile-input text-sm py-1.5" placeholder="Source table (required)" />
                                <input id="transfer-draft-target-table" type="text" value="${escapeHtml(transferDraftTargetTable)}" class="w-full tactile-input text-sm py-1.5" placeholder="Target table (optional)" />
                                <select id="transfer-draft-mode" class="w-full tactile-input text-sm py-1.5">
                                    <option value="append" ${transferDraftMode === 'append' ? 'selected' : ''}>append</option>
                                    <option value="replace" ${transferDraftMode === 'replace' ? 'selected' : ''}>replace</option>
                                    <option value="upsert" ${transferDraftMode === 'upsert' ? 'selected' : ''}>upsert</option>
                                </select>
                                <select id="transfer-draft-sink-type" class="w-full tactile-input text-sm py-1.5">
                                    <option value="database" ${transferDraftSinkType === 'database' ? 'selected' : ''}>database</option>
                                    <option value="csv" ${transferDraftSinkType === 'csv' ? 'selected' : ''}>csv</option>
                                    <option value="jsonl" ${transferDraftSinkType === 'jsonl' ? 'selected' : ''}>jsonl</option>
                                    <option value="sql" ${transferDraftSinkType === 'sql' ? 'selected' : ''}>sql</option>
                                </select>
                                <input id="transfer-draft-keys" type="text" value="${escapeHtml(transferDraftKeyColumns)}" class="w-full tactile-input text-sm py-1.5" placeholder="Key columns (for upsert)" />
                                <input id="transfer-draft-sink-path" type="text" value="${escapeHtml(transferDraftSinkPath)}" class="w-full tactile-input text-sm py-1.5" placeholder="Sink path (required for file sinks)" />
                            </div>
                            <div class="flex items-center justify-between">
                                <div class="text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">
                                    Objects: ${transferObjects.length}
                                </div>
                                <button id="transfer-add-object-btn" class="px-3 py-2 rounded text-xs font-bold ${isDawn ? 'bg-[#31748f] text-white' : 'bg-mysql-teal text-white'} hover:brightness-110 transition-all">
                                    Add Object
                                </button>
                            </div>
                            <div class="max-h-[220px] overflow-auto custom-scrollbar border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} rounded-lg">
                                <table class="w-full">
                                    <thead class="${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-black/20 text-gray-400')}">
                                        <tr>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">#</th>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Source</th>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Target</th>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Mode</th>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Sink</th>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Sink Path</th>
                                            <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Key Columns</th>
                                            <th class="px-2 py-2 text-right text-[10px] uppercase tracking-widest">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${objectRows || `
                                            <tr>
                                                <td colspan="8" class="px-3 py-3 text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                                                    Add at least one object to transfer.
                                                </td>
                                            </tr>
                                        `}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-white/5')} p-3 space-y-2">
                            <div>
                                <label class="block text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')} mb-1">Mapping Profile</label>
                                <input id="transfer-mapping-profile" type="text" value="${escapeHtml(transferMappingProfile)}" class="w-full tactile-input text-sm py-1.5" placeholder="Optional profile name" />
                            </div>
                            <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                                <input id="transfer-include-schema" type="checkbox" class="w-4 h-4" ${transferIncludeSchemaMigration ? 'checked' : ''} />
                                Include schema migration preflight
                            </label>
                            <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                                <input id="transfer-lock-guard" type="checkbox" class="w-4 h-4" ${transferLockGuard ? 'checked' : ''} />
                                Enable lock guard
                            </label>
                            <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                                <input id="transfer-dry-run" type="checkbox" class="w-4 h-4" ${transferDryRun ? 'checked' : ''} />
                                Start as dry run
                            </label>
                        </div>

                        <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-white/5')} p-3 space-y-2">
                            <button id="transfer-preview-btn" class="w-full px-3 py-2 rounded text-xs font-bold ${isDawn ? 'bg-[#31748f] text-white' : 'bg-mysql-teal text-white'} hover:brightness-110 transition-all">
                                Preview Plan
                            </button>
                            <button id="transfer-start-btn" class="w-full px-3 py-2 rounded text-xs font-bold ${isDawn ? 'bg-[#ea9d34] text-[#fffaf3]' : 'bg-emerald-500 text-white'} hover:brightness-110 transition-all">
                                ${transferDryRun ? 'Start Dry Run' : 'Start Transfer'}
                            </button>
                            <button id="transfer-cancel-btn" class="w-full px-3 py-2 rounded text-xs font-bold ${canCancelActiveRun ? (isDawn ? 'bg-[#b4637a] text-white' : 'bg-red-500 text-white') : (isLight ? 'bg-gray-200 text-gray-500' : 'bg-white/10 text-gray-500')} transition-all" ${canCancelActiveRun ? '' : 'disabled'}>
                                Cancel Active Run
                            </button>
                            <button id="transfer-task-payload-btn" class="w-full px-3 py-2 rounded text-xs font-bold ${isDawn ? 'bg-[#286983] text-white' : 'bg-blue-600 text-white'} hover:brightness-110 transition-all">
                                Generate Task Payload
                            </button>
                            <button id="transfer-runs-refresh-btn" class="w-full px-3 py-2 rounded text-xs font-bold ${isDawn ? 'bg-[#797593] text-[#fffaf3]' : 'bg-gray-600 text-white'} hover:brightness-110 transition-all">
                                Refresh Runs
                            </button>
                        </div>

                        <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-white/5')} p-3 space-y-2">
                            <div class="text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Mapping Rule Validation</div>
                            <input id="transfer-mapping-source" type="text" value="${escapeHtml(transferMappingSourceColumn)}" class="w-full tactile-input text-sm py-1.5" placeholder="Source column" />
                            <input id="transfer-mapping-target" type="text" value="${escapeHtml(transferMappingTargetColumn)}" class="w-full tactile-input text-sm py-1.5" placeholder="Target column" />
                            <input id="transfer-mapping-cast" type="text" value="${escapeHtml(transferMappingCastType)}" class="w-full tactile-input text-sm py-1.5" placeholder="Cast type (optional)" />
                            <button id="transfer-validate-mapping-btn" class="w-full px-3 py-2 rounded text-xs font-bold ${isDawn ? 'bg-[#31748f] text-white' : 'bg-mysql-teal text-white'} hover:brightness-110 transition-all">
                                Validate Mapping Rule
                            </button>
                            ${transferMappingValidationMessage ? `
                                <div class="text-[11px] ${isLight ? 'text-emerald-700' : (isDawn ? 'text-[#286983]' : 'text-emerald-300')}">
                                    ${escapeHtml(transferMappingValidationMessage)}
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    ${transferError ? `
                        <div class="rounded-lg border ${isLight ? 'border-red-200 bg-red-50 text-red-700' : (isDawn ? 'border-[#b4637a]/40 bg-[#b4637a]/10 text-[#b4637a]' : 'border-red-400/30 bg-red-500/10 text-red-400')} px-3 py-2 text-sm">
                            ${escapeHtml(transferError)}
                        </div>
                    ` : ''}

                    ${transferWarnings.length > 0 ? `
                        <div class="rounded-lg border ${isLight ? 'border-amber-200 bg-amber-50 text-amber-700' : (isDawn ? 'border-[#ea9d34]/40 bg-[#ea9d34]/10 text-[#ea9d34]' : 'border-amber-400/30 bg-amber-500/10 text-amber-300')} px-3 py-2 text-xs">
                            ${transferWarnings.map((warning) => `<div>• ${escapeHtml(warning)}</div>`).join('')}
                        </div>
                    ` : ''}

                    ${transferPlanPreview ? `
                        <div class="rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-white/5')} p-3">
                            <div class="text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Plan Preview</div>
                            <div class="mt-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')} space-y-1">
                                <div>Plan ID: <span class="font-mono">${escapeHtml(transferPlanPreview.planId)}</span></div>
                                <div>Objects: <b>${transferPlanPreview.objectCount}</b></div>
                                <div>Source: ${escapeHtml(transferPlanPreview.sourceDatabase)} (${escapeHtml(transferPlanPreview.sourceConnectionId)})</div>
                                <div>Target: ${escapeHtml(transferPlanPreview.targetDatabase)} (${escapeHtml(transferPlanPreview.targetConnectionId)})</div>
                            </div>
                            ${transferSchemaPreflight ? `
                                <div class="mt-3 pt-3 border-t ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')}">
                                    <div class="text-[10px] font-black uppercase tracking-[0.16em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Schema Preflight</div>
                                    <div class="mt-2 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')} space-y-1">
                                        <div>
                                            Status: <b>${escapeHtml(transferSchemaPreflightStatus || '-')}</b>
                                            ${transferSchemaPreflight.strategy ? ` | Strategy: <b>${escapeHtml(transferSchemaPreflight.strategy)}</b>` : ''}
                                        </div>
                                        <div>
                                            Diff: +${Number(transferSchemaPreflight.newTableCount || 0)} / -${Number(transferSchemaPreflight.droppedTableCount || 0)} / ~${Number(transferSchemaPreflight.modifiedTableCount || 0)}
                                            | Breaking: ${Number(transferSchemaPreflight.breakingChangeCount || 0)}
                                        </div>
                                        <div>
                                            Migration Warnings: ${Number(transferSchemaPreflight.migrationWarningCount || 0)}
                                            | Unsupported: ${Number(transferSchemaPreflight.unsupportedStatementCount || 0)}
                                            | External Commands: ${Number(transferSchemaPreflight.externalCommandCount || 0)}
                                        </div>
                                    </div>
                                    ${transferSchemaPreflight.error ? `
                                        <div class="mt-2 text-[11px] ${isLight ? 'text-red-700' : (isDawn ? 'text-[#b4637a]' : 'text-red-400')}">
                                            ${escapeHtml(transferSchemaPreflight.error)}
                                        </div>
                                    ` : ''}
                                    ${transferSchemaPreflightWarnings.length > 0 ? `
                                        <div class="mt-2 space-y-1 text-[11px] ${isLight ? 'text-amber-700' : (isDawn ? 'text-[#ea9d34]' : 'text-amber-300')}">
                                            ${transferSchemaPreflightWarnings.slice(0, 6).map((warning) => `<div>• ${escapeHtml(warning)}</div>`).join('')}
                                        </div>
                                    ` : ''}
                                    ${transferSchemaPreflight.migrationScriptPreview ? `
                                        <details class="mt-2">
                                            <summary class="cursor-pointer text-[11px] font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">
                                                Migration Script Preview
                                            </summary>
                                            <pre class="mt-2 p-2 text-[10px] leading-relaxed ${isLight ? 'text-gray-700 bg-white border border-gray-200' : (isDawn ? 'text-[#575279] bg-[#fffaf3] border border-[#f2e9e1]' : 'text-gray-300 bg-black/20 border border-white/10')} rounded max-h-[220px] overflow-auto custom-scrollbar">${escapeHtml(transferSchemaPreflight.migrationScriptPreview)}</pre>
                                        </details>
                                    ` : ''}
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}

                    ${activeRun ? `
                        <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} overflow-hidden">
                            <div class="px-3 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">
                                <span>Active Run</span>
                                <span class="${activeRunStatusClass}">${escapeHtml(activeRunStatus)}</span>
                            </div>
                            <div class="p-3 space-y-2">
                                <div class="text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')}">
                                    Operation: <span class="font-mono">${escapeHtml(activeRun.operationId)}</span>
                                </div>
                                <div class="w-full h-2 rounded ${isLight ? 'bg-gray-200' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/10')} overflow-hidden">
                                    <div class="h-full ${isDawn ? 'bg-[#31748f]' : 'bg-mysql-teal'} transition-all duration-300" style="width:${activeRunProgress}%"></div>
                                </div>
                                <div class="text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-300')}">
                                    ${activeRun.processedObjects || 0}/${activeRun.objectCount || 0} objects | dryRun: ${activeRun.dryRun ? 'yes' : 'no'}
                                </div>
                                <div class="text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">
                                    Started: ${escapeHtml(formatTransferTime(activeRun.startedAt))} | Updated: ${escapeHtml(formatTransferTime(activeRun.updatedAt))}
                                </div>
                                ${activeRun.error ? `<div class="text-[11px] ${isLight ? 'text-red-600' : (isDawn ? 'text-[#b4637a]' : 'text-red-400')}">${escapeHtml(activeRun.error)}</div>` : ''}
                            </div>
                        </div>
                    ` : ''}

                    ${transferTaskPayload ? `
                        <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} overflow-hidden">
                            <div class="px-3 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">
                                <span>Task Payload</span>
                                <button id="transfer-copy-task-payload-btn" class="px-2 py-1 rounded text-[10px] font-bold ${isDawn ? 'bg-[#31748f] text-white' : 'bg-mysql-teal text-white'} hover:brightness-110 transition-all">Copy</button>
                            </div>
                            <pre class="p-3 text-[11px] leading-relaxed ${isLight ? 'text-gray-700 bg-white' : (isDawn ? 'text-[#575279] bg-[#fffaf3]' : 'text-gray-300 bg-black/20')} max-h-[280px] overflow-auto custom-scrollbar">${escapeHtml(JSON.stringify(transferTaskPayload, null, 2))}</pre>
                        </div>
                    ` : ''}

                    <div class="rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/10')} overflow-hidden">
                        <div class="px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] ${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">Recent Transfer Runs</div>
                        <div class="max-h-[260px] overflow-auto custom-scrollbar">
                            <table class="w-full">
                                <thead class="${isLight ? 'bg-gray-50 text-gray-500' : (isDawn ? 'bg-[#faf4ed] text-[#9893a5]' : 'bg-white/5 text-gray-400')}">
                                    <tr>
                                        <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">#</th>
                                        <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Status</th>
                                        <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Route</th>
                                        <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Progress</th>
                                        <th class="px-2 py-2 text-left text-[10px] uppercase tracking-widest">Started</th>
                                        <th class="px-2 py-2 text-right text-[10px] uppercase tracking-widest">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${historyRows || `
                                        <tr>
                                            <td colspan="6" class="px-3 py-3 text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                                                No transfer runs yet.
                                            </td>
                                        </tr>
                                    `}
                                </tbody>
                            </table>
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
            stopTransferStatusPolling();
            activeTab = 'export';
            render();
        });
        container.querySelector('#tab-import')?.addEventListener('click', () => {
            stopTransferStatusPolling();
            activeTab = 'import';
            render();
        });
        container.querySelector('#tab-backup')?.addEventListener('click', () => {
            stopTransferStatusPolling();
            activeTab = 'backup';
            render();
        });
        container.querySelector('#tab-mock')?.addEventListener('click', async () => {
            stopTransferStatusPolling();
            activeTab = 'mock';
            render();
            loadMockJobHistory();
            if (selectedDb && selectedTable && currentMockSchemaKey() !== mockSchemaKey) {
                await loadMockSchema();
            }
        });
        container.querySelector('#tab-compare')?.addEventListener('click', async () => {
            stopTransferStatusPolling();
            activeTab = 'compare';
            resetCompareOutputs();
            render();

            if (!compareSourceDb && databases.length > 0) {
                compareSourceDb = databases[0];
                await loadCompareTables('source', compareSourceDb);
            }
            if (!compareTargetDb && databases.length > 0) {
                compareTargetDb = databases[0];
                await loadCompareTables('target', compareTargetDb);
            }
            if (compareSourceDb && compareSourceTable && compareTargetDb && compareTargetTable) {
                await loadCompareMetadata();
            }
        });
        container.querySelector('#tab-transfer')?.addEventListener('click', async () => {
            activeTab = 'transfer';
            render();
            await loadTransferConnections();
            await loadTransferRunHistory();
            if (transferActiveRun && isTransferRunActive(transferActiveRun)) {
                startTransferStatusPolling(transferActiveRun.operationId);
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

        // Data Compare controls
        container.querySelector('#compare-source-db')?.addEventListener('change', async (e) => {
            compareSourceDb = e.target.value;
            compareSourceTable = '';
            compareSourceTables = [];
            resetCompareColumnState();
            resetCompareOutputs();
            render();
            await loadCompareTables('source', compareSourceDb);
        });
        container.querySelector('#compare-target-db')?.addEventListener('change', async (e) => {
            compareTargetDb = e.target.value;
            compareTargetTable = '';
            compareTargetTables = [];
            resetCompareColumnState();
            resetCompareOutputs();
            render();
            await loadCompareTables('target', compareTargetDb);
        });
        container.querySelector('#compare-source-table')?.addEventListener('change', async (e) => {
            compareSourceTable = e.target.value;
            resetCompareColumnState();
            resetCompareOutputs();
            render();
            await loadCompareMetadata();
        });
        container.querySelector('#compare-target-table')?.addEventListener('change', async (e) => {
            compareTargetTable = e.target.value;
            resetCompareColumnState();
            resetCompareOutputs();
            render();
            await loadCompareMetadata();
        });
        container.querySelector('#compare-sample-limit')?.addEventListener('change', (e) => {
            compareSettings.sampleLimit = ensurePositiveInt(e.target.value, 50);
            e.target.value = String(compareSettings.sampleLimit);
        });
        container.querySelector('#compare-max-rows')?.addEventListener('change', (e) => {
            compareSettings.maxRows = ensurePositiveInt(e.target.value, 20000);
            e.target.value = String(compareSettings.maxRows);
        });
        container.querySelector('#compare-statement-limit')?.addEventListener('change', (e) => {
            compareSettings.statementLimit = ensurePositiveInt(e.target.value, 10000);
            e.target.value = String(compareSettings.statementLimit);
        });
        container.querySelector('#compare-include-inserts')?.addEventListener('change', (e) => {
            compareSettings.includeInserts = !!e.target.checked;
        });
        container.querySelector('#compare-include-updates')?.addEventListener('change', (e) => {
            compareSettings.includeUpdates = !!e.target.checked;
        });
        container.querySelector('#compare-include-deletes')?.addEventListener('change', (e) => {
            compareSettings.includeDeletes = !!e.target.checked;
        });
        container.querySelector('#compare-wrap-tx')?.addEventListener('change', (e) => {
            compareSettings.wrapInTransaction = !!e.target.checked;
        });
        container.querySelector('#compare-use-pk-btn')?.addEventListener('click', () => {
            compareSelectedKeyColumns = orderTokensBySharedColumns(compareSharedPkColumns);
            const keySet = new Set(compareSelectedKeyColumns);
            compareSelectedCompareColumns = orderTokensBySharedColumns(
                compareSelectedCompareColumns.filter((token) => !keySet.has(token))
            );
            resetCompareOutputs();
            render();
        });
        container.querySelector('#compare-select-all-cols-btn')?.addEventListener('click', () => {
            const keySet = new Set(compareSelectedKeyColumns);
            compareSelectedCompareColumns = orderTokensBySharedColumns(
                compareSharedColumns
                    .map((column) => column.token)
                    .filter((token) => !keySet.has(token))
            );
            resetCompareOutputs();
            render();
        });
        container.querySelector('#compare-clear-cols-btn')?.addEventListener('click', () => {
            compareSelectedCompareColumns = [];
            resetCompareOutputs();
            render();
        });
        container.querySelectorAll('.compare-key-checkbox').forEach((checkbox) => {
            checkbox.addEventListener('change', (e) => {
                const token = e.target.dataset.columnToken;
                setCompareKeyColumn(token, !!e.target.checked);
                resetCompareOutputs();
                render();
            });
        });
        container.querySelectorAll('.compare-column-checkbox').forEach((checkbox) => {
            checkbox.addEventListener('change', (e) => {
                const token = e.target.dataset.columnToken;
                setCompareCompareColumn(token, !!e.target.checked);
                resetCompareOutputs();
                render();
            });
        });
        container.querySelector('#compare-run-btn')?.addEventListener('click', handleCompareRun);
        container.querySelector('#compare-script-btn')?.addEventListener('click', handleCompareGenerateScript);
        container.querySelector('#compare-copy-script-btn')?.addEventListener('click', async () => {
            if (!comparePlan?.script) return;
            try {
                await navigator.clipboard.writeText(comparePlan.script);
                Dialog.alert('Sync script copied to clipboard.', 'Data Compare');
            } catch (error) {
                Dialog.alert(`Failed to copy script: ${error}`, 'Data Compare');
            }
        });

        // Data Transfer controls
        container.querySelector('#transfer-source-connection')?.addEventListener('change', (e) => {
            transferSourceConnectionId = e.target.value || '';
            resetTransferPlanArtifacts();
            render();
        });
        container.querySelector('#transfer-target-connection')?.addEventListener('change', (e) => {
            transferTargetConnectionId = e.target.value || '';
            resetTransferPlanArtifacts();
            render();
        });
        container.querySelector('#transfer-source-db')?.addEventListener('change', (e) => {
            transferSourceDatabase = String(e.target.value || '').trim();
            resetTransferPlanArtifacts();
            render();
        });
        container.querySelector('#transfer-target-db')?.addEventListener('change', (e) => {
            transferTargetDatabase = String(e.target.value || '').trim();
            resetTransferPlanArtifacts();
            render();
        });
        container.querySelector('#transfer-mapping-profile')?.addEventListener('change', (e) => {
            transferMappingProfile = String(e.target.value || '').trim();
            resetTransferPlanArtifacts();
        });
        container.querySelector('#transfer-include-schema')?.addEventListener('change', (e) => {
            transferIncludeSchemaMigration = !!e.target.checked;
            resetTransferPlanArtifacts();
        });
        container.querySelector('#transfer-lock-guard')?.addEventListener('change', (e) => {
            transferLockGuard = !!e.target.checked;
            resetTransferPlanArtifacts();
        });
        container.querySelector('#transfer-dry-run')?.addEventListener('change', (e) => {
            transferDryRun = !!e.target.checked;
            render();
        });
        container.querySelector('#transfer-draft-source-table')?.addEventListener('change', (e) => {
            transferDraftSourceTable = e.target.value || '';
        });
        container.querySelector('#transfer-draft-target-table')?.addEventListener('change', (e) => {
            transferDraftTargetTable = e.target.value || '';
        });
        container.querySelector('#transfer-draft-mode')?.addEventListener('change', (e) => {
            transferDraftMode = e.target.value || 'append';
        });
        container.querySelector('#transfer-draft-sink-type')?.addEventListener('change', (e) => {
            transferDraftSinkType = e.target.value || 'database';
            if (transferDraftSinkType === 'database') {
                transferDraftSinkPath = '';
            }
            render();
        });
        container.querySelector('#transfer-draft-keys')?.addEventListener('change', (e) => {
            transferDraftKeyColumns = e.target.value || '';
        });
        container.querySelector('#transfer-draft-sink-path')?.addEventListener('change', (e) => {
            transferDraftSinkPath = e.target.value || '';
        });
        container.querySelector('#transfer-add-object-btn')?.addEventListener('click', handleTransferAddObject);
        container.querySelectorAll('.transfer-remove-object-btn').forEach((button) => {
            button.addEventListener('click', (e) => {
                const index = Number.parseInt(e.currentTarget.dataset.transferIndex || '-1', 10);
                handleTransferRemoveObject(index);
            });
        });
        container.querySelector('#transfer-preview-btn')?.addEventListener('click', handleTransferPreviewPlan);
        container.querySelector('#transfer-start-btn')?.addEventListener('click', handleTransferStart);
        container.querySelector('#transfer-cancel-btn')?.addEventListener('click', handleTransferCancel);
        container.querySelector('#transfer-task-payload-btn')?.addEventListener('click', handleTransferGenerateTaskPayload);
        container.querySelector('#transfer-runs-refresh-btn')?.addEventListener('click', loadTransferRunHistory);
        container.querySelector('#transfer-mapping-source')?.addEventListener('change', (e) => {
            transferMappingSourceColumn = e.target.value || '';
        });
        container.querySelector('#transfer-mapping-target')?.addEventListener('change', (e) => {
            transferMappingTargetColumn = e.target.value || '';
        });
        container.querySelector('#transfer-mapping-cast')?.addEventListener('change', (e) => {
            transferMappingCastType = e.target.value || '';
        });
        container.querySelector('#transfer-validate-mapping-btn')?.addEventListener('click', handleTransferValidateMappingRule);
        container.querySelector('#transfer-copy-task-payload-btn')?.addEventListener('click', async () => {
            if (!transferTaskPayload) return;
            try {
                await navigator.clipboard.writeText(JSON.stringify(transferTaskPayload, null, 2));
                Dialog.alert('Transfer task payload copied to clipboard.', 'Data Transfer');
            } catch (error) {
                Dialog.alert(`Failed to copy payload: ${error}`, 'Data Transfer');
            }
        });
        container.querySelectorAll('.transfer-select-run-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const opId = button.dataset.operationId;
                selectTransferRun(opId);
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
        stopTransferStatusPolling();
    };

    // Initialize - render first, then load data
    render();
    loadDatabases();

    return container;
}
