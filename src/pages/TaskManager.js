import { Dialog } from '../components/UI/Dialog.js';
import { TaskManagerApi } from '../api/taskManager.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { escapeHtml, formatTimeAgo } from '../utils/helpers.js';
import { toastError, toastInfo, toastSuccess } from '../utils/Toast.js';

const TASK_TYPE_OPTIONS = [
    { value: 'sql_script', label: 'SQL Script' },
    { value: 'backup', label: 'Backup' },
    { value: 'schema_snapshot', label: 'Schema Snapshot' },
    { value: 'data_compare_sync', label: 'Data Compare + Sync' },
    { value: 'data_transfer_migration', label: 'Data Transfer + Migration' },
    { value: 'composite', label: 'Composite' },
];

const TASK_STATUS_OPTIONS = [
    { value: 'active', label: 'Active' },
    { value: 'paused', label: 'Paused' },
    { value: 'disabled', label: 'Disabled' },
];

const TRIGGER_TYPE_OPTIONS = [
    { value: 'interval', label: 'Interval' },
    { value: 'cron', label: 'Cron' },
    { value: 'one_shot', label: 'One Shot' },
];

const MISFIRE_OPTIONS = [
    { value: 'fire_now', label: 'Fire Now' },
    { value: 'skip', label: 'Skip' },
    { value: 'reschedule', label: 'Reschedule' },
];

const COMPOSITE_MODE_OPTIONS = [
    { value: 'inline', label: 'Inline' },
    { value: 'reference', label: 'Reference Task' },
];

const COMPOSITE_STEP_ON_ERROR_OPTIONS = [
    { value: '', label: 'Default' },
    { value: 'stop', label: 'Stop' },
    { value: 'continue', label: 'Continue' },
];

const INLINE_COMPOSITE_TASK_TYPES = TASK_TYPE_OPTIONS.filter((option) => option.value !== 'composite');

export function TaskManager() {
    const container = document.createElement('div');
    let theme = ThemeManager.getCurrentTheme();

    let isLoadingTasks = false;
    let isLoadingDetails = false;
    let tasks = [];
    let selectedTaskId = '';
    let selectedRunId = '';
    let triggers = [];
    let runs = [];
    let runLogs = [];
    let compositeStepRuns = [];
    let isSubmittingTaskForm = false;
    let isTaskDrawerOpen = false;
    let taskDrawerMode = 'create';
    let taskDrawerTaskId = '';
    let isRunActionBusy = false;
    let schedulerState = 'running';
    let isUpdatingSchedulerState = false;
    let retentionDays = 30;
    let isUpdatingRetentionPolicy = false;
    let isPurgingTaskHistory = false;
    let isLoadingCompositeGraph = false;
    let isSavingCompositeGraph = false;
    let compositeDraft = {
        taskId: '',
        steps: [],
        edges: [],
    };
    let compositeValidation = {
        errors: [],
        hasInvalidDependency: false,
    };

    const taskForm = {
        name: '',
        description: '',
        taskType: 'sql_script',
        status: 'active',
        tags: '',
        owner: '',
        payload: '{}',
    };

    const taskFilters = {
        taskType: '',
        status: '',
        owner: '',
        tag: '',
    };

    const triggerForm = {
        triggerType: 'interval',
        intervalSeconds: 3600,
        cronExpression: '*/30 * * * *',
        runAt: '',
        timezone: 'UTC',
        misfirePolicy: 'fire_now',
        retryMaxAttempts: 0,
        retryBackoffMs: 0,
        enabled: true,
    };

    const cronBuilder = {
        minute: '*/30',
        hour: '*',
    };

    const getContainerClass = (currentTheme) => {
        const isLight = currentTheme === 'light';
        const isDawn = currentTheme === 'dawn';
        const isOceanic =
            currentTheme === 'oceanic' || currentTheme === 'ember' || currentTheme === 'aurora';
        const isNeon = currentTheme === 'neon';
        return `h-full overflow-hidden flex flex-col p-4 lg:p-6 ${isLight
            ? 'bg-gray-50'
            : isDawn
                ? 'bg-[#fffaf3]'
                : isOceanic
                    ? 'bg-ocean-bg'
                    : isNeon
                        ? 'bg-neon-bg'
                        : 'bg-[#0a0c10]'
            }`;
    };

    const selectedTask = () => tasks.find((task) => task.id === selectedTaskId) || null;

    const statusBadgeClass = (status, isLight, isDawn, isNeon) => {
        if (isNeon) {
            if (status === 'active') return 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30';
            if (status === 'paused') return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
            if (status === 'disabled') return 'text-neon-pink bg-neon-pink/10 border-neon-pink/30';
            return 'text-neon-text/70 bg-neon-panel border-neon-border/40';
        }
        if (status === 'active') return 'text-emerald-600 bg-emerald-500/10 border-emerald-500/30';
        if (status === 'paused') return 'text-amber-600 bg-amber-500/10 border-amber-500/30';
        if (status === 'disabled') return 'text-gray-500 bg-gray-500/10 border-gray-500/30';
        return isLight || isDawn
            ? 'text-gray-600 bg-gray-100 border-gray-200'
            : 'text-gray-300 bg-white/5 border-white/10';
    };

    const runStatusBadgeClass = (status) => {
        if (status === 'success') return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
        if (status === 'failed') return 'text-red-500 bg-red-500/10 border-red-500/30';
        if (status === 'running') return 'text-blue-500 bg-blue-500/10 border-blue-500/30';
        if (status === 'queued') return 'text-amber-500 bg-amber-500/10 border-amber-500/30';
        if (status === 'cancelled') return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
        return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    };

    const triggerTypeLabel = (triggerType) =>
        TRIGGER_TYPE_OPTIONS.find((item) => item.value === triggerType)?.label || triggerType;

    const taskTypeLabel = (taskType) =>
        TASK_TYPE_OPTIONS.find((item) => item.value === taskType)?.label || taskType;

    const schedulerStateLabel = (state) => {
        if (state === 'paused') return 'Paused';
        if (state === 'disabled') return 'Disabled';
        return 'Running';
    };

    const schedulerStateBadgeClass = (state, isLight, isDawn, isNeon) => {
        if (isNeon) {
            if (state === 'paused') return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
            if (state === 'disabled') return 'text-neon-pink bg-neon-pink/10 border-neon-pink/30';
            return 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30';
        }
        if (state === 'paused') return 'text-amber-600 bg-amber-500/10 border-amber-500/30';
        if (state === 'disabled') return 'text-red-600 bg-red-500/10 border-red-500/30';
        return isLight || isDawn
            ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/30'
            : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    };

    const toLocalDateTimeInput = (value) => {
        if (!value) return '';
        const dt = new Date(value);
        if (Number.isNaN(dt.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    };

    const formatDateTime = (value) => {
        if (!value) return '-';
        const dt = new Date(value);
        if (Number.isNaN(dt.getTime())) return '-';
        return dt.toLocaleString();
    };

    const trimToNull = (value) => {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    };

    const safeJsonStringify = (value) => {
        try {
            return JSON.stringify(value ?? {}, null, 2);
        } catch {
            return '{}';
        }
    };

    const nextCompositeStepKey = (steps = compositeDraft.steps) => {
        const existingSteps = Array.isArray(steps) ? steps : [];
        const existing = new Set(existingSteps.map((step) => step.stepKey));
        let cursor = existingSteps.length + 1;
        while (existing.has(`step_${cursor}`)) {
            cursor += 1;
        }
        return `step_${cursor}`;
    };

    const createCompositeStepDraft = (steps = compositeDraft.steps) => ({
        stepKey: nextCompositeStepKey(steps),
        position: (Array.isArray(steps) ? steps.length : 0) + 1,
        mode: 'inline',
        taskType: 'sql_script',
        referencedTaskId: '',
        payloadText: '{}',
        onError: '',
        enabled: true,
    });

    const normalizeCompositeDraft = () => {
        const steps = Array.isArray(compositeDraft.steps) ? compositeDraft.steps : [];
        compositeDraft.steps = steps.map((step, index) => ({
            stepKey: String(step.stepKey || ''),
            position: index + 1,
            mode: step.mode === 'reference' ? 'reference' : 'inline',
            taskType: step.taskType || 'sql_script',
            referencedTaskId: String(step.referencedTaskId || ''),
            payloadText: typeof step.payloadText === 'string' ? step.payloadText : safeJsonStringify(step.payloadText),
            onError: typeof step.onError === 'string' ? step.onError : '',
            enabled: step.enabled !== false,
        }));

        const edges = Array.isArray(compositeDraft.edges) ? compositeDraft.edges : [];
        compositeDraft.edges = edges.map((edge) => ({
            fromStepKey: String(edge.fromStepKey || ''),
            toStepKey: String(edge.toStepKey || ''),
            condition: typeof edge.condition === 'string' ? edge.condition : '',
        }));
    };

    const detectCompositeCycle = (edges) => {
        const adjacency = new Map();
        edges.forEach((edge) => {
            const from = edge.fromStepKey.trim();
            const to = edge.toStepKey.trim();
            if (!from || !to) return;
            const neighbors = adjacency.get(from) || [];
            neighbors.push(to);
            adjacency.set(from, neighbors);
        });

        const visiting = new Set();
        const visited = new Set();
        const stack = [];

        const dfs = (node) => {
            if (visiting.has(node)) {
                const cycleStart = stack.indexOf(node);
                if (cycleStart >= 0) {
                    const path = stack.slice(cycleStart);
                    path.push(node);
                    return path;
                }
                return [node, node];
            }
            if (visited.has(node)) return null;

            visiting.add(node);
            stack.push(node);

            const neighbors = adjacency.get(node) || [];
            for (const nextNode of neighbors) {
                const path = dfs(nextNode);
                if (path) {
                    return path;
                }
            }

            stack.pop();
            visiting.delete(node);
            visited.add(node);
            return null;
        };

        for (const node of adjacency.keys()) {
            const cyclePath = dfs(node);
            if (cyclePath) {
                return cyclePath;
            }
        }

        return null;
    };

    const computeCompositeValidation = () => {
        const errors = [];
        const dependencyErrors = [];
        const stepKeySet = new Set();

        if (compositeDraft.steps.length === 0) {
            errors.push('At least one step is required.');
        }

        compositeDraft.steps.forEach((step, index) => {
            const label = `Step ${index + 1}`;
            const stepKey = step.stepKey.trim();
            if (!stepKey) {
                errors.push(`${label}: step key is required.`);
            } else if (stepKeySet.has(stepKey)) {
                errors.push(`${label}: duplicate step key "${stepKey}".`);
            } else {
                stepKeySet.add(stepKey);
            }

            if (step.mode === 'reference') {
                if (!step.referencedTaskId.trim()) {
                    errors.push(`${label}: referenced task id is required in reference mode.`);
                }
            } else if (!INLINE_COMPOSITE_TASK_TYPES.some((item) => item.value === step.taskType)) {
                errors.push(`${label}: invalid task type.`);
            }

            try {
                const parsed = step.payloadText.trim() ? JSON.parse(step.payloadText) : {};
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    errors.push(`${label}: payload must be a JSON object.`);
                }
            } catch (error) {
                errors.push(`${label}: invalid payload JSON (${error.message || String(error)}).`);
            }
        });

        const normalizedEdges = [];
        compositeDraft.edges.forEach((edge, index) => {
            const edgeLabel = `Dependency ${index + 1}`;
            const fromStepKey = edge.fromStepKey.trim();
            const toStepKey = edge.toStepKey.trim();

            if (!fromStepKey || !toStepKey) {
                dependencyErrors.push(`${edgeLabel}: both from and to steps are required.`);
                return;
            }

            if (fromStepKey === toStepKey) {
                dependencyErrors.push(`${edgeLabel}: self dependency "${fromStepKey}" is not allowed.`);
                return;
            }

            if (!stepKeySet.has(fromStepKey) || !stepKeySet.has(toStepKey)) {
                dependencyErrors.push(`${edgeLabel}: references unknown step key.`);
                return;
            }

            normalizedEdges.push({ fromStepKey, toStepKey });
        });

        const cyclePath = detectCompositeCycle(normalizedEdges);
        if (cyclePath) {
            dependencyErrors.push(`Dependency cycle: ${cyclePath.join(' -> ')}`);
        }

        if (dependencyErrors.length > 0) {
            errors.push(...dependencyErrors);
        }

        return {
            errors,
            hasInvalidDependency: dependencyErrors.length > 0,
        };
    };

    const recomputeCompositeValidation = () => {
        normalizeCompositeDraft();
        compositeValidation = computeCompositeValidation();
    };

    const resetCompositeDraft = (taskId = '', { withDefaultStep = false } = {}) => {
        const defaultSteps = withDefaultStep ? [createCompositeStepDraft([])] : [];
        compositeDraft = {
            taskId,
            steps: defaultSteps,
            edges: [],
        };
        recomputeCompositeValidation();
    };

    const setCompositeDraftFromGraph = (taskId, graph) => {
        const stepsFromGraph = Array.isArray(graph?.steps) ? [...graph.steps] : [];
        stepsFromGraph.sort((a, b) => (a.position || 0) - (b.position || 0));

        const mappedSteps = stepsFromGraph.map((step) => {
            const hasReference = typeof step.referencedTaskId === 'string' && step.referencedTaskId.trim();
            return {
                stepKey: String(step.stepKey || ''),
                position: Number.parseInt(String(step.position || 0), 10) || 1,
                mode: hasReference ? 'reference' : 'inline',
                taskType: step.taskType || 'sql_script',
                referencedTaskId: String(step.referencedTaskId || ''),
                payloadText: safeJsonStringify(step.payload),
                onError: typeof step.onError === 'string' ? step.onError : '',
                enabled: step.enabled !== false,
            };
        });

        const mappedEdges = Array.isArray(graph?.edges)
            ? graph.edges.map((edge) => ({
                fromStepKey: String(edge.fromStepKey || ''),
                toStepKey: String(edge.toStepKey || ''),
                condition: typeof edge.condition === 'string' ? edge.condition : '',
            }))
            : [];

        compositeDraft = {
            taskId,
            steps: mappedSteps.length > 0 ? mappedSteps : [createCompositeStepDraft([])],
            edges: mappedEdges,
        };
        recomputeCompositeValidation();
    };

    const buildCompositeGraphPayload = () => {
        const task = selectedTask();
        if (!task || task.taskType !== 'composite') {
            throw new Error('Select a composite task first.');
        }

        const steps = compositeDraft.steps.map((step, index) => {
            let parsedPayload = {};
            try {
                parsedPayload = step.payloadText.trim() ? JSON.parse(step.payloadText) : {};
            } catch (error) {
                throw new Error(`Step ${index + 1} payload is invalid JSON: ${error.message || String(error)}`);
            }

            if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
                throw new Error(`Step ${index + 1} payload must be a JSON object.`);
            }

            return {
                stepKey: step.stepKey.trim(),
                position: index + 1,
                taskType: step.mode === 'inline' ? step.taskType : null,
                referencedTaskId: step.mode === 'reference' ? trimToNull(step.referencedTaskId) : null,
                payload: parsedPayload,
                onError: trimToNull(step.onError),
                enabled: step.enabled !== false,
            };
        });

        const edges = compositeDraft.edges.map((edge) => ({
            fromStepKey: edge.fromStepKey.trim(),
            toStepKey: edge.toStepKey.trim(),
            condition: trimToNull(edge.condition),
        }));

        return {
            taskId: task.id,
            steps,
            edges,
        };
    };

    const buildTaskPayload = () => {
        let payload = {};
        try {
            payload = taskForm.payload.trim() ? JSON.parse(taskForm.payload) : {};
        } catch (error) {
            throw new Error(`Invalid payload JSON: ${error.message || String(error)}`);
        }

        return {
            name: taskForm.name.trim(),
            description: taskForm.description.trim() || null,
            taskType: taskForm.taskType,
            status: taskForm.status,
            payload,
            tags: taskForm.tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            owner: taskForm.owner.trim() || null,
        };
    };

    const buildTaskListRequest = () => {
        const request = {
            limit: 300,
            sortBy: 'updated_at',
            sortDesc: true,
        };
        const taskType = trimToNull(taskFilters.taskType);
        const status = trimToNull(taskFilters.status);
        const owner = trimToNull(taskFilters.owner);
        const tag = trimToNull(taskFilters.tag);
        if (taskType) request.taskType = taskType;
        if (status) request.status = status;
        if (owner) request.owner = owner;
        if (tag) request.tag = tag;
        return request;
    };

    const upsertTaskInMemory = (task) => {
        if (!task || !task.id) return;
        const idx = tasks.findIndex((entry) => entry.id === task.id);
        if (idx >= 0) {
            tasks[idx] = {
                ...tasks[idx],
                ...task,
            };
        } else {
            tasks.unshift(task);
        }
        tasks.sort((a, b) => {
            const left = Date.parse(a.updatedAt || 0) || 0;
            const right = Date.parse(b.updatedAt || 0) || 0;
            return right - left;
        });
    };

    const deleteTaskInMemory = (taskId) => {
        tasks = tasks.filter((task) => task.id !== taskId);
    };

    const openTaskDrawerForCreate = () => {
        taskDrawerMode = 'create';
        taskDrawerTaskId = '';
        isTaskDrawerOpen = true;
        resetTaskForm();
        render();
    };

    const openTaskDrawerForEdit = () => {
        const task = selectedTask();
        if (!task) {
            toastInfo('Select a task first.');
            return;
        }
        taskDrawerMode = 'edit';
        taskDrawerTaskId = task.id;
        isTaskDrawerOpen = true;
        taskForm.name = task.name || '';
        taskForm.description = task.description || '';
        taskForm.taskType = task.taskType || 'sql_script';
        taskForm.status = task.status || 'active';
        taskForm.tags = Array.isArray(task.tags) ? task.tags.join(', ') : '';
        taskForm.owner = task.owner || '';
        taskForm.payload = safeJsonStringify(task.payload);
        render();
    };

    const closeTaskDrawer = () => {
        isTaskDrawerOpen = false;
        isSubmittingTaskForm = false;
        render();
    };

    const parseCronField = (field, min, max) => {
        const set = new Set();
        const tokens = String(field || '')
            .split(',')
            .map((item) => item.trim());
        if (tokens.length === 0) {
            throw new Error(`Invalid cron field "${field}"`);
        }

        for (const token of tokens) {
            if (!token) {
                throw new Error(`Invalid cron token "${field}"`);
            }
            if (token === '*') {
                for (let value = min; value <= max; value += 1) {
                    set.add(value);
                }
                continue;
            }
            if (token.startsWith('*/')) {
                const step = Number.parseInt(token.slice(2), 10);
                if (!Number.isInteger(step) || step <= 0) {
                    throw new Error(`Invalid cron step "${token}"`);
                }
                for (let value = min; value <= max; value += step) {
                    set.add(value);
                }
                continue;
            }
            if (token.includes('-')) {
                const [startRaw, endRaw] = token.split('-', 2);
                const start = Number.parseInt(startRaw, 10);
                const end = Number.parseInt(endRaw, 10);
                if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start < min || end > max) {
                    throw new Error(`Invalid cron range "${token}"`);
                }
                for (let value = start; value <= end; value += 1) {
                    set.add(value);
                }
                continue;
            }
            const value = Number.parseInt(token, 10);
            if (!Number.isInteger(value) || value < min || value > max) {
                throw new Error(`Invalid cron value "${token}"`);
            }
            set.add(value);
        }

        return set;
    };

    const validateCronExpression = (expr) => {
        const parts = String(expr || '')
            .trim()
            .split(/\s+/);
        if (parts.length !== 5) {
            return 'Cron expression must have 5 fields: min hour day month dow.';
        }
        if (parts[2] !== '*' || parts[3] !== '*' || parts[4] !== '*') {
            return 'Current cron support requires day/month/dow as "* * *".';
        }
        try {
            parseCronField(parts[0], 0, 59);
            parseCronField(parts[1], 0, 23);
        } catch (error) {
            return error.message || String(error);
        }
        return null;
    };

    const computeCronPreviewRuns = (expr, count = 5) => {
        const parts = String(expr || '')
            .trim()
            .split(/\s+/);
        const minuteSet = parseCronField(parts[0], 0, 59);
        const hourSet = parseCronField(parts[1], 0, 23);

        const preview = [];
        const now = new Date();
        let probe = new Date(now.getTime() + 60000);
        probe.setUTCSeconds(0, 0);

        for (let guard = 0; guard < 366 * 24 * 60 && preview.length < count; guard += 1) {
            if (hourSet.has(probe.getUTCHours()) && minuteSet.has(probe.getUTCMinutes())) {
                preview.push(new Date(probe.getTime()));
            }
            probe = new Date(probe.getTime() + 60000);
        }
        return preview;
    };

    const buildCronExpressionFromBuilder = () => {
        const minute = String(cronBuilder.minute || '').trim();
        const hour = String(cronBuilder.hour || '').trim();
        if (!minute || !hour) return;
        triggerForm.cronExpression = `${minute} ${hour} * * *`;
    };

    const getTriggerPreview = () => {
        if (triggerForm.triggerType === 'interval') {
            const seconds = Number.parseInt(String(triggerForm.intervalSeconds || 0), 10);
            if (!Number.isInteger(seconds) || seconds <= 0) {
                return { error: 'Interval must be a positive integer (seconds).', values: [] };
            }
            const now = Date.now();
            const values = Array.from({ length: 5 }, (_, index) => new Date(now + (index + 1) * seconds * 1000));
            return { error: null, values };
        }
        if (triggerForm.triggerType === 'one_shot') {
            if (!triggerForm.runAt) {
                return { error: 'Run at datetime is required.', values: [] };
            }
            const runAt = new Date(triggerForm.runAt);
            if (Number.isNaN(runAt.getTime())) {
                return { error: 'Run at datetime is invalid.', values: [] };
            }
            return { error: null, values: [runAt] };
        }

        const expr = triggerForm.cronExpression.trim();
        if (!expr) {
            return { error: 'Cron expression is required.', values: [] };
        }
        const cronError = validateCronExpression(expr);
        if (cronError) {
            return { error: cronError, values: [] };
        }
        return { error: null, values: computeCronPreviewRuns(expr, 5) };
    };

    const buildTriggerPayload = () => {
        const payload = {
            taskId: selectedTaskId,
            triggerType: triggerForm.triggerType,
            cronExpression: null,
            intervalSeconds: null,
            runAt: null,
            timezone: triggerForm.timezone.trim() || null,
            misfirePolicy: triggerForm.misfirePolicy,
            retryPolicy: {
                maxAttempts: Number.parseInt(triggerForm.retryMaxAttempts, 10) || 0,
                backoffMs: Number.parseInt(triggerForm.retryBackoffMs, 10) || 0,
            },
            enabled: !!triggerForm.enabled,
        };

        if (triggerForm.triggerType === 'interval') {
            payload.intervalSeconds = Number.parseInt(triggerForm.intervalSeconds, 10) || 0;
        }
        if (triggerForm.triggerType === 'cron') {
            payload.cronExpression = triggerForm.cronExpression.trim() || null;
        }
        if (triggerForm.triggerType === 'one_shot' && triggerForm.runAt) {
            payload.runAt = new Date(triggerForm.runAt).toISOString();
        }
        return payload;
    };

    const resetTaskForm = () => {
        taskForm.name = '';
        taskForm.description = '';
        taskForm.taskType = 'sql_script';
        taskForm.status = 'active';
        taskForm.tags = '';
        taskForm.owner = '';
        taskForm.payload = '{}';
    };

    const resetDetailState = () => {
        triggers = [];
        runs = [];
        runLogs = [];
        compositeStepRuns = [];
        selectedRunId = '';
        isLoadingCompositeGraph = false;
        isSavingCompositeGraph = false;
        resetCompositeDraft();
    };

    const refreshTasks = async ({ keepSelection = true } = {}) => {
        isLoadingTasks = true;
        render();

        try {
            const [taskRows, nextSchedulerState, retentionPolicy] = await Promise.all([
                TaskManagerApi.listTasks(buildTaskListRequest()),
                TaskManagerApi.getSchedulerState().catch(() => schedulerState),
                TaskManagerApi.getTaskLogRetentionPolicy().catch(() => ({ retentionDays })),
            ]);

            tasks = taskRows;
            if (typeof nextSchedulerState === 'string' && nextSchedulerState.trim()) {
                schedulerState = nextSchedulerState.trim().toLowerCase();
            }
            if (retentionPolicy && Number.isFinite(Number(retentionPolicy.retentionDays))) {
                retentionDays = Number.parseInt(String(retentionPolicy.retentionDays), 10);
            }

            if (!keepSelection || !tasks.some((task) => task.id === selectedTaskId)) {
                selectedTaskId = tasks[0]?.id || '';
            }
            await refreshTaskDetails();
        } catch (error) {
            toastError(`Failed to load tasks: ${String(error)}`);
        } finally {
            isLoadingTasks = false;
            render();
        }
    };

    const refreshTaskDetails = async () => {
        if (!selectedTaskId) {
            resetDetailState();
            render();
            return;
        }

        isLoadingDetails = true;
        render();

        try {
            const [triggerRows, runRows] = await Promise.all([
                TaskManagerApi.listTaskTriggers({ taskId: selectedTaskId, limit: 200 }),
                TaskManagerApi.getTaskRuns(selectedTaskId, 100),
            ]);

            triggers = Array.isArray(triggerRows) ? triggerRows : [];
            runs = Array.isArray(runRows) ? runRows : [];

            if (!runs.some((run) => run.id === selectedRunId)) {
                selectedRunId = runs[0]?.id || '';
            }

            if (selectedRunId) {
                const [logs, stepRuns] = await Promise.all([
                    TaskManagerApi.getTaskRunLogs(selectedRunId, 1200),
                    TaskManagerApi.getCompositeStepRuns(selectedRunId, 500).catch(() => []),
                ]);
                runLogs = logs;
                compositeStepRuns = Array.isArray(stepRuns) ? stepRuns : [];
            } else {
                runLogs = [];
                compositeStepRuns = [];
            }

            const task = selectedTask();
            if (task?.taskType === 'composite') {
                isLoadingCompositeGraph = true;
                render();
                try {
                    const graph = await TaskManagerApi.getCompositeTaskGraph(task.id);
                    setCompositeDraftFromGraph(task.id, graph || null);
                } catch (error) {
                    resetCompositeDraft(task.id, { withDefaultStep: true });
                    toastError(`Failed to load composite graph: ${String(error)}`);
                } finally {
                    isLoadingCompositeGraph = false;
                }
            } else {
                resetCompositeDraft();
            }
        } catch (error) {
            toastError(`Failed to load task details: ${String(error)}`);
        } finally {
            isLoadingDetails = false;
            render();
        }
    };

    const setSchedulerState = async (nextState) => {
        if (!nextState || nextState === schedulerState) return;

        isUpdatingSchedulerState = true;
        render();

        try {
            const updatedState = await TaskManagerApi.setSchedulerState(nextState);
            schedulerState = typeof updatedState === 'string'
                ? updatedState.trim().toLowerCase()
                : nextState;
            toastSuccess(`Scheduler ${schedulerStateLabel(schedulerState).toLowerCase()}.`);
        } catch (error) {
            toastError(`Scheduler state update failed: ${String(error)}`);
            try {
                const currentState = await TaskManagerApi.getSchedulerState();
                if (typeof currentState === 'string' && currentState.trim()) {
                    schedulerState = currentState.trim().toLowerCase();
                }
            } catch {
                // no-op
            }
        } finally {
            isUpdatingSchedulerState = false;
            render();
        }
    };

    const setTaskLogRetentionPolicy = async (nextDays) => {
        const parsed = Number.parseInt(String(nextDays), 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            toastError('Retention days must be a positive integer.');
            return;
        }

        isUpdatingRetentionPolicy = true;
        render();
        try {
            const policy = await TaskManagerApi.setTaskLogRetentionPolicy(parsed);
            if (policy && Number.isFinite(Number(policy.retentionDays))) {
                retentionDays = Number.parseInt(String(policy.retentionDays), 10);
            } else {
                retentionDays = parsed;
            }
            toastSuccess(`Retention policy set to ${retentionDays} days.`);
        } catch (error) {
            toastError(`Failed to update retention policy: ${String(error)}`);
        } finally {
            isUpdatingRetentionPolicy = false;
            render();
        }
    };

    const purgeTaskHistory = async (forceRetentionDays = null) => {
        const confirmMessage = forceRetentionDays
            ? `Purge task history older than ${forceRetentionDays} days?`
            : `Purge task history older than ${retentionDays} days?`;
        const ok = await Dialog.confirm(confirmMessage, 'Purge Task History');
        if (!ok) return;

        isPurgingTaskHistory = true;
        render();
        try {
            const result = await TaskManagerApi.purgeTaskHistory(forceRetentionDays);
            toastSuccess(
                `Purge complete. Logs: ${result.deletedRunLogs}, Runs: ${result.deletedRuns}, Audit: ${result.deletedAuditLogs}`
            );
            await refreshTaskDetails();
        } catch (error) {
            toastError(`Task history purge failed: ${String(error)}`);
        } finally {
            isPurgingTaskHistory = false;
            render();
        }
    };

    const submitTaskForm = async () => {
        let payload;
        try {
            payload = buildTaskPayload();
        } catch (error) {
            toastError(String(error));
            return;
        }

        if (!payload.name) {
            toastError('Task name is required.');
            return;
        }
        if (!payload.payload || typeof payload.payload !== 'object' || Array.isArray(payload.payload)) {
            toastError('Task payload must be a JSON object.');
            return;
        }

        isSubmittingTaskForm = true;
        render();
        try {
            if (taskDrawerMode === 'edit' && taskDrawerTaskId) {
                const updated = await TaskManagerApi.updateTask({
                    taskId: taskDrawerTaskId,
                    ...payload,
                });
                upsertTaskInMemory(updated);
                selectedTaskId = updated?.id || selectedTaskId;
                toastSuccess('Task updated.');
            } else {
                const created = await TaskManagerApi.createTask(payload);
                upsertTaskInMemory(created);
                selectedTaskId = created?.id || selectedTaskId;
                toastSuccess('Task created.');
            }

            closeTaskDrawer();
            await refreshTaskDetails();
            await refreshTasks({ keepSelection: true });
        } catch (error) {
            toastError(`Task save failed: ${String(error)}`);
        } finally {
            isSubmittingTaskForm = false;
            render();
        }
    };

    const removeTask = async () => {
        const task = selectedTask();
        if (!task) return;

        const ok = await Dialog.confirm(
            `Delete task "${task.name}"? This removes related triggers and run logs.`,
            'Delete Task'
        );
        if (!ok) return;

        try {
            await TaskManagerApi.deleteTask(task.id);
            deleteTaskInMemory(task.id);
            toastSuccess('Task deleted.');
            selectedTaskId = '';
            await refreshTasks({ keepSelection: false });
        } catch (error) {
            toastError(`Task delete failed: ${String(error)}`);
        }
    };

    const runTaskNow = async () => {
        const task = selectedTask();
        if (!task) {
            toastInfo('Select a task first.');
            return;
        }

        try {
            const run = await TaskManagerApi.runTaskNow(task.id);
            if (run?.status === 'failed') {
                toastError('Task run failed. Check run logs for details.');
            } else {
                toastSuccess('Task run completed.');
            }
            await refreshTaskDetails();
        } catch (error) {
            toastError(`Manual run failed: ${String(error)}`);
            await refreshTaskDetails();
        }
    };

    const cancelSelectedRun = async () => {
        const run = runs.find((item) => item.id === selectedRunId);
        if (!run) {
            toastInfo('Select a run first.');
            return;
        }
        if (!(run.status === 'running' || run.status === 'queued')) {
            toastInfo('Only running or queued runs can be cancelled.');
            return;
        }

        isRunActionBusy = true;
        render();
        try {
            await TaskManagerApi.cancelTaskRun(run.id);
            toastSuccess('Run cancellation requested.');
            await refreshTaskDetails();
            await refreshTasks({ keepSelection: true });
        } catch (error) {
            toastError(`Cancel run failed: ${String(error)}`);
        } finally {
            isRunActionBusy = false;
            render();
        }
    };

    const retrySelectedRun = async () => {
        const run = runs.find((item) => item.id === selectedRunId);
        if (!run) {
            toastInfo('Select a run first.');
            return;
        }
        if (run.status === 'running' || run.status === 'queued') {
            toastInfo('Wait for the run to finish before retrying.');
            return;
        }

        isRunActionBusy = true;
        render();
        try {
            const retryRun = await TaskManagerApi.retryTaskRun(run.id);
            selectedRunId = retryRun?.id || selectedRunId;
            if (retryRun?.status === 'failed') {
                toastError('Retry run failed. Check logs for details.');
            } else {
                toastSuccess('Retry run completed.');
            }
            await refreshTaskDetails();
            await refreshTasks({ keepSelection: true });
        } catch (error) {
            toastError(`Retry run failed: ${String(error)}`);
        } finally {
            isRunActionBusy = false;
            render();
        }
    };

    const createTrigger = async () => {
        if (!selectedTaskId) {
            toastInfo('Select a task first.');
            return;
        }

        const preview = getTriggerPreview();
        if (preview.error) {
            toastError(preview.error);
            return;
        }

        try {
            await TaskManagerApi.createTaskTrigger(buildTriggerPayload());
            toastSuccess('Trigger created.');
            await refreshTaskDetails();
        } catch (error) {
            toastError(`Trigger creation failed: ${String(error)}`);
        }
    };

    const removeTrigger = async (triggerId) => {
        const ok = await Dialog.confirm('Delete this trigger?', 'Delete Trigger');
        if (!ok) return;

        try {
            await TaskManagerApi.deleteTaskTrigger(triggerId);
            toastSuccess('Trigger deleted.');
            await refreshTaskDetails();
        } catch (error) {
            toastError(`Trigger delete failed: ${String(error)}`);
        }
    };

    const selectTask = async (taskId) => {
        if (!taskId || taskId === selectedTaskId) return;
        selectedTaskId = taskId;
        resetCompositeDraft();
        await refreshTaskDetails();
    };

    const selectRun = async (runId) => {
        selectedRunId = runId;
        render();
        if (!runId) {
            runLogs = [];
            compositeStepRuns = [];
            render();
            return;
        }
        try {
            const [logs, stepRuns] = await Promise.all([
                TaskManagerApi.getTaskRunLogs(runId, 1200),
                TaskManagerApi.getCompositeStepRuns(runId, 500).catch(() => []),
            ]);
            runLogs = logs;
            compositeStepRuns = Array.isArray(stepRuns) ? stepRuns : [];
        } catch (error) {
            toastError(`Failed to load run logs: ${String(error)}`);
        } finally {
            render();
        }
    };

    const addCompositeStep = () => {
        compositeDraft.steps.push(createCompositeStepDraft());
        recomputeCompositeValidation();
        render();
    };

    const removeCompositeStep = (index) => {
        if (index < 0 || index >= compositeDraft.steps.length) return;
        const removedStep = compositeDraft.steps[index];
        compositeDraft.steps.splice(index, 1);
        if (removedStep?.stepKey) {
            compositeDraft.edges = compositeDraft.edges.filter((edge) => {
                const from = edge.fromStepKey.trim();
                const to = edge.toStepKey.trim();
                return from !== removedStep.stepKey.trim() && to !== removedStep.stepKey.trim();
            });
        }
        recomputeCompositeValidation();
        render();
    };

    const moveCompositeStep = (index, direction) => {
        const nextIndex = direction === 'up' ? index - 1 : index + 1;
        if (index < 0 || nextIndex < 0 || index >= compositeDraft.steps.length || nextIndex >= compositeDraft.steps.length) {
            return;
        }
        const [moved] = compositeDraft.steps.splice(index, 1);
        compositeDraft.steps.splice(nextIndex, 0, moved);
        recomputeCompositeValidation();
        render();
    };

    const updateCompositeStepField = (index, field, value) => {
        if (index < 0 || index >= compositeDraft.steps.length) return;
        const step = compositeDraft.steps[index];
        if (!step) return;

        if (field === 'enabled') {
            step.enabled = !!value;
        } else if (field === 'mode') {
            step.mode = value === 'reference' ? 'reference' : 'inline';
        } else {
            step[field] = typeof value === 'string' ? value : String(value ?? '');
        }

        recomputeCompositeValidation();
        render();
    };

    const addCompositeEdge = () => {
        compositeDraft.edges.push({
            fromStepKey: '',
            toStepKey: '',
            condition: '',
        });
        recomputeCompositeValidation();
        render();
    };

    const removeCompositeEdge = (index) => {
        if (index < 0 || index >= compositeDraft.edges.length) return;
        compositeDraft.edges.splice(index, 1);
        recomputeCompositeValidation();
        render();
    };

    const updateCompositeEdgeField = (index, field, value) => {
        if (index < 0 || index >= compositeDraft.edges.length) return;
        const edge = compositeDraft.edges[index];
        if (!edge) return;
        edge[field] = typeof value === 'string' ? value : String(value ?? '');
        recomputeCompositeValidation();
        render();
    };

    const reloadCompositeGraph = async () => {
        const task = selectedTask();
        if (!task || task.taskType !== 'composite') return;

        isLoadingCompositeGraph = true;
        render();
        try {
            const graph = await TaskManagerApi.getCompositeTaskGraph(task.id);
            setCompositeDraftFromGraph(task.id, graph || null);
            toastSuccess('Composite graph reloaded.');
        } catch (error) {
            toastError(`Composite graph reload failed: ${String(error)}`);
        } finally {
            isLoadingCompositeGraph = false;
            render();
        }
    };

    const saveCompositeGraph = async () => {
        const task = selectedTask();
        if (!task || task.taskType !== 'composite') {
            toastInfo('Select a composite task first.');
            return;
        }

        recomputeCompositeValidation();
        if (compositeValidation.errors.length > 0) {
            render();
            toastError('Composite graph has validation errors. Fix them before saving.');
            return;
        }

        isSavingCompositeGraph = true;
        render();
        try {
            const request = buildCompositeGraphPayload();
            await TaskManagerApi.upsertCompositeTaskGraph(request);
            toastSuccess('Composite graph saved.');
            await refreshTaskDetails();
        } catch (error) {
            toastError(`Composite graph save failed: ${String(error)}`);
        } finally {
            isSavingCompositeGraph = false;
            render();
        }
    };

    const bindEvents = () => {
        container.querySelector('#task-refresh-btn')?.addEventListener('click', () => {
            refreshTasks({ keepSelection: true });
        });
        container.querySelector('#scheduler-running-btn')?.addEventListener('click', () => {
            setSchedulerState('running');
        });
        container.querySelector('#scheduler-paused-btn')?.addEventListener('click', () => {
            setSchedulerState('paused');
        });
        container.querySelector('#scheduler-disabled-btn')?.addEventListener('click', () => {
            setSchedulerState('disabled');
        });
        container.querySelector('#task-retention-apply-btn')?.addEventListener('click', () => {
            const inputValue = container.querySelector('#task-retention-days-input')?.value || '';
            setTaskLogRetentionPolicy(inputValue);
        });
        container.querySelector('#task-retention-purge-btn')?.addEventListener('click', () => {
            purgeTaskHistory(null);
        });

        container.querySelector('#task-open-create-btn')?.addEventListener('click', openTaskDrawerForCreate);
        container.querySelector('#task-open-edit-btn')?.addEventListener('click', openTaskDrawerForEdit);
        container.querySelector('#task-drawer-close-btn')?.addEventListener('click', closeTaskDrawer);
        container.querySelector('#task-drawer-overlay')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) {
                closeTaskDrawer();
            }
        });
        container.querySelector('#task-upsert-form')?.addEventListener('submit', (event) => {
            event.preventDefault();
            taskForm.name = container.querySelector('#task-form-name')?.value || '';
            taskForm.description = container.querySelector('#task-form-description')?.value || '';
            taskForm.taskType = container.querySelector('#task-form-type')?.value || 'sql_script';
            taskForm.status = container.querySelector('#task-form-status')?.value || 'active';
            taskForm.tags = container.querySelector('#task-form-tags')?.value || '';
            taskForm.owner = container.querySelector('#task-form-owner')?.value || '';
            taskForm.payload = container.querySelector('#task-form-payload')?.value || '{}';
            submitTaskForm();
        });
        container.querySelector('#task-filter-type')?.addEventListener('change', (event) => {
            taskFilters.taskType = event.currentTarget.value || '';
            refreshTasks({ keepSelection: false });
        });
        container.querySelector('#task-filter-status')?.addEventListener('change', (event) => {
            taskFilters.status = event.currentTarget.value || '';
            refreshTasks({ keepSelection: false });
        });
        container.querySelector('#task-filter-owner')?.addEventListener('input', (event) => {
            taskFilters.owner = event.currentTarget.value || '';
            refreshTasks({ keepSelection: false });
        });
        container.querySelector('#task-filter-tag')?.addEventListener('input', (event) => {
            taskFilters.tag = event.currentTarget.value || '';
            refreshTasks({ keepSelection: false });
        });
        container.querySelector('#task-filter-reset')?.addEventListener('click', () => {
            taskFilters.taskType = '';
            taskFilters.status = '';
            taskFilters.owner = '';
            taskFilters.tag = '';
            refreshTasks({ keepSelection: false });
        });

        container.querySelector('#task-delete-btn')?.addEventListener('click', removeTask);
        container.querySelector('#task-run-now-btn')?.addEventListener('click', runTaskNow);
        container.querySelector('#task-cancel-run-btn')?.addEventListener('click', cancelSelectedRun);
        container.querySelector('#task-retry-run-btn')?.addEventListener('click', retrySelectedRun);

        container.querySelectorAll('[data-task-id]').forEach((el) => {
            el.addEventListener('click', () => selectTask(el.getAttribute('data-task-id')));
        });

        container.querySelector('#trigger-create-form')?.addEventListener('submit', (event) => {
            event.preventDefault();
            triggerForm.triggerType = container.querySelector('#trigger-form-type')?.value || 'interval';
            triggerForm.intervalSeconds =
                Number.parseInt(container.querySelector('#trigger-form-interval')?.value || '0', 10) || 0;
            cronBuilder.minute = container.querySelector('#trigger-cron-minute')?.value || cronBuilder.minute;
            cronBuilder.hour = container.querySelector('#trigger-cron-hour')?.value || cronBuilder.hour;
            buildCronExpressionFromBuilder();
            const cronInput = container.querySelector('#trigger-form-cron')?.value || '';
            triggerForm.cronExpression = cronInput || triggerForm.cronExpression;
            triggerForm.runAt = container.querySelector('#trigger-form-run-at')?.value || '';
            triggerForm.timezone = container.querySelector('#trigger-form-timezone')?.value || 'UTC';
            triggerForm.misfirePolicy = container.querySelector('#trigger-form-misfire')?.value || 'fire_now';
            triggerForm.retryMaxAttempts =
                Number.parseInt(container.querySelector('#trigger-form-retry-attempts')?.value || '0', 10) || 0;
            triggerForm.retryBackoffMs =
                Number.parseInt(container.querySelector('#trigger-form-retry-backoff')?.value || '0', 10) || 0;
            triggerForm.enabled = !!container.querySelector('#trigger-form-enabled')?.checked;
            createTrigger();
        });

        container.querySelector('#trigger-build-cron-btn')?.addEventListener('click', () => {
            cronBuilder.minute = container.querySelector('#trigger-cron-minute')?.value || cronBuilder.minute;
            cronBuilder.hour = container.querySelector('#trigger-cron-hour')?.value || cronBuilder.hour;
            buildCronExpressionFromBuilder();
            render();
        });

        container.querySelectorAll('[data-trigger-input]').forEach((el) => {
            el.addEventListener('change', (event) => {
                const id = event.currentTarget.id;
                if (id === 'trigger-form-type') {
                    triggerForm.triggerType = event.currentTarget.value || 'interval';
                } else if (id === 'trigger-form-interval') {
                    triggerForm.intervalSeconds = Number.parseInt(event.currentTarget.value || '0', 10) || 0;
                } else if (id === 'trigger-form-cron') {
                    triggerForm.cronExpression = event.currentTarget.value || '';
                } else if (id === 'trigger-form-run-at') {
                    triggerForm.runAt = event.currentTarget.value || '';
                } else if (id === 'trigger-form-timezone') {
                    triggerForm.timezone = event.currentTarget.value || 'UTC';
                } else if (id === 'trigger-form-misfire') {
                    triggerForm.misfirePolicy = event.currentTarget.value || 'fire_now';
                } else if (id === 'trigger-form-retry-attempts') {
                    triggerForm.retryMaxAttempts = Number.parseInt(event.currentTarget.value || '0', 10) || 0;
                } else if (id === 'trigger-form-retry-backoff') {
                    triggerForm.retryBackoffMs = Number.parseInt(event.currentTarget.value || '0', 10) || 0;
                } else if (id === 'trigger-form-enabled') {
                    triggerForm.enabled = !!event.currentTarget.checked;
                } else if (id === 'trigger-cron-minute') {
                    cronBuilder.minute = event.currentTarget.value || cronBuilder.minute;
                } else if (id === 'trigger-cron-hour') {
                    cronBuilder.hour = event.currentTarget.value || cronBuilder.hour;
                }
                render();
            });
        });

        container.querySelectorAll('[data-trigger-id]').forEach((el) => {
            el.addEventListener('click', () => removeTrigger(el.getAttribute('data-trigger-id')));
        });

        container.querySelectorAll('[data-run-id]').forEach((el) => {
            el.addEventListener('click', () => selectRun(el.getAttribute('data-run-id')));
        });

        container.querySelector('#composite-reload-btn')?.addEventListener('click', reloadCompositeGraph);
        container.querySelector('#composite-save-btn')?.addEventListener('click', saveCompositeGraph);
        container.querySelector('#composite-add-step-btn')?.addEventListener('click', addCompositeStep);
        container.querySelector('#composite-add-edge-btn')?.addEventListener('click', addCompositeEdge);

        container.querySelectorAll('[data-composite-step-action]').forEach((el) => {
            el.addEventListener('click', () => {
                const action = el.getAttribute('data-composite-step-action');
                const index = Number.parseInt(el.getAttribute('data-step-index') || '-1', 10);
                if (action === 'remove') {
                    removeCompositeStep(index);
                } else if (action === 'move-up') {
                    moveCompositeStep(index, 'up');
                } else if (action === 'move-down') {
                    moveCompositeStep(index, 'down');
                }
            });
        });

        container.querySelectorAll('[data-composite-step-field]').forEach((el) => {
            const handler = (event) => {
                const target = event.currentTarget;
                const index = Number.parseInt(target.getAttribute('data-step-index') || '-1', 10);
                const field = target.getAttribute('data-composite-step-field');
                if (!field) return;
                if (target instanceof HTMLInputElement && target.type === 'checkbox') {
                    updateCompositeStepField(index, field, !!target.checked);
                    return;
                }
                updateCompositeStepField(index, field, target.value || '');
            };

            el.addEventListener('change', handler);
        });

        container.querySelectorAll('[data-composite-edge-action]').forEach((el) => {
            el.addEventListener('click', () => {
                const action = el.getAttribute('data-composite-edge-action');
                const index = Number.parseInt(el.getAttribute('data-edge-index') || '-1', 10);
                if (action === 'remove') {
                    removeCompositeEdge(index);
                }
            });
        });

        container.querySelectorAll('[data-composite-edge-field]').forEach((el) => {
            const handler = (event) => {
                const target = event.currentTarget;
                const index = Number.parseInt(target.getAttribute('data-edge-index') || '-1', 10);
                const field = target.getAttribute('data-composite-edge-field');
                if (!field) return;
                updateCompositeEdgeField(index, field, target.value || '');
            };
            el.addEventListener('change', handler);
        });
    };

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';
        const task = selectedTask();
        const isCompositeTask = task?.taskType === 'composite';
        if (isCompositeTask) {
            recomputeCompositeValidation();
        }
        const compositeErrors = isCompositeTask ? compositeValidation.errors : [];
        const compositeHasErrors = compositeErrors.length > 0;
        const compositeCanSave = isCompositeTask
            && !isLoadingCompositeGraph
            && !isSavingCompositeGraph
            && !compositeHasErrors;
        const compositeStepKeyOptions = compositeDraft.steps
            .map((step) => step.stepKey.trim())
            .filter(Boolean);
        const triggerPreview = getTriggerPreview();
        const selectedRun = runs.find((item) => item.id === selectedRunId) || null;
        const canCancelRun = !!selectedRun && (selectedRun.status === 'running' || selectedRun.status === 'queued');
        const canRetryRun = !!selectedRun && selectedRun.status !== 'running' && selectedRun.status !== 'queued';

        container.className = getContainerClass(theme);
        container.innerHTML = `
            <div class="shrink-0 flex items-center justify-between mb-4">
                <div>
                    <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white'))}">Task Center</h1>
                    <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400'))}">Task management, scheduler and run history</p>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-[11px] px-2 py-1 rounded-full border ${schedulerStateBadgeClass(schedulerState, isLight, isDawn, isNeon)}">
                        Scheduler: ${escapeHtml(schedulerStateLabel(schedulerState))}
                    </span>
                    <button id="scheduler-running-btn" class="px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${schedulerState === 'running'
                ? (isDawn ? 'bg-[#f7efe4] border-[#ea9d34]/40 text-[#8f5a21]' : 'bg-mysql-teal/10 border-mysql-teal/30 text-mysql-teal')
                : (isLight ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'))
            } ${isUpdatingSchedulerState ? 'opacity-60 pointer-events-none' : ''}">
                        Running
                    </button>
                    <button id="scheduler-paused-btn" class="px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${schedulerState === 'paused'
                ? (isLight ? 'bg-amber-100 border-amber-300 text-amber-700' : 'bg-amber-500/15 border-amber-500/30 text-amber-300')
                : (isLight ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'))
            } ${isUpdatingSchedulerState ? 'opacity-60 pointer-events-none' : ''}">
                        Pause
                    </button>
                    <button id="scheduler-disabled-btn" class="px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${schedulerState === 'disabled'
                ? (isLight ? 'bg-red-100 border-red-300 text-red-700' : 'bg-red-500/15 border-red-500/30 text-red-300')
                : (isLight ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'))
            } ${isUpdatingSchedulerState ? 'opacity-60 pointer-events-none' : ''}">
                        Disable
                    </button>
                    <div class="flex items-center gap-1.5 rounded-lg border px-2 py-1 ${isLight
                ? 'bg-white border-gray-200'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10')} ${isUpdatingRetentionPolicy || isPurgingTaskHistory ? 'opacity-70' : ''}">
                        <span class="text-[10px] uppercase tracking-wider ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Retention</span>
                        <input id="task-retention-days-input" type="number" min="1" max="3650" value="${escapeHtml(String(retentionDays))}"
                            class="w-16 rounded border px-1.5 py-1 text-[11px] ${isLight
                ? 'bg-gray-50 border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')} ${isUpdatingRetentionPolicy || isPurgingTaskHistory ? 'pointer-events-none' : ''}">
                        <span class="text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">days</span>
                        <button id="task-retention-apply-btn" class="px-2 py-1 rounded border text-[10px] font-semibold transition-colors ${isLight
                ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#f7efe4]' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10')
            } ${isUpdatingRetentionPolicy || isPurgingTaskHistory ? 'pointer-events-none opacity-70' : ''}">
                            ${isUpdatingRetentionPolicy ? 'Saving' : 'Apply'}
                        </button>
                        <button id="task-retention-purge-btn" class="px-2 py-1 rounded border text-[10px] font-semibold transition-colors ${isLight
                ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
            } ${isUpdatingRetentionPolicy || isPurgingTaskHistory ? 'pointer-events-none opacity-70' : ''}">
                            ${isPurgingTaskHistory ? 'Purging' : 'Purge'}
                        </button>
                    </div>
                    <button id="task-refresh-btn" class="px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${isLight
                ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] hover:bg-[#faf4ed]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text hover:bg-neon-accent/10' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'))}">
                        Refresh
                    </button>
                </div>
            </div>

            <div class="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-4">
                <section class="xl:col-span-4 min-h-0 flex flex-col gap-4">
                    <div class="rounded-xl border p-3 min-h-0 flex-1 flex flex-col ${isLight
                ? 'bg-white border-gray-200 shadow-sm'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-none' : (isNeon ? 'bg-neon-panel border-neon-border/30 shadow-none' : 'bg-white/5 border-white/10 shadow-none'))}">
                        <div class="flex items-center justify-between mb-3">
                            <h2 class="text-sm font-semibold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-200'))}">Tasks</h2>
                            <button id="task-open-create-btn" class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-colors ${isDawn ? 'bg-[#ea9d34] hover:bg-[#d18b2f]' : 'bg-mysql-teal hover:bg-mysql-teal/90'}">
                                New Task
                            </button>
                        </div>

                        <div class="grid grid-cols-2 gap-2 mb-3">
                            <select id="task-filter-type" class="rounded-lg border px-2 py-1.5 text-[11px] ${isLight
                ? 'bg-white border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-[#1a1d23] border-white/10 text-gray-200'))}">
                                <option value="" ${taskFilters.taskType ? '' : 'selected'}>All Types</option>
                                ${TASK_TYPE_OPTIONS.map((option) => `
                                    <option value="${option.value}" ${taskFilters.taskType === option.value ? 'selected' : ''}>${option.label}</option>
                                `).join('')}
                            </select>
                            <select id="task-filter-status" class="rounded-lg border px-2 py-1.5 text-[11px] ${isLight
                ? 'bg-white border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-[#1a1d23] border-white/10 text-gray-200'))}">
                                <option value="" ${taskFilters.status ? '' : 'selected'}>All Status</option>
                                ${TASK_STATUS_OPTIONS.map((option) => `
                                    <option value="${option.value}" ${taskFilters.status === option.value ? 'selected' : ''}>${option.label}</option>
                                `).join('')}
                            </select>
                            <input id="task-filter-owner" value="${escapeHtml(taskFilters.owner)}" placeholder="Owner"
                                class="rounded-lg border px-2 py-1.5 text-[11px] ${isLight
                ? 'bg-white border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-[#1a1d23] border-white/10 text-gray-200'))}">
                            <input id="task-filter-tag" value="${escapeHtml(taskFilters.tag)}" placeholder="Tag"
                                class="rounded-lg border px-2 py-1.5 text-[11px] ${isLight
                ? 'bg-white border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-[#1a1d23] border-white/10 text-gray-200'))}">
                        </div>
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/50' : 'text-gray-400'))}">${tasks.length} task(s)</span>
                            <button id="task-filter-reset" class="px-2 py-1 rounded border text-[10px] font-semibold ${isLight
                ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#f7efe4]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text hover:bg-neon-accent/10' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'))}">
                                Reset Filters
                            </button>
                        </div>

                        <div class="flex-1 min-h-0 overflow-auto custom-scrollbar space-y-2">
                            ${isLoadingTasks
                ? `<div class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">Loading tasks...</div>`
                : tasks.length === 0
                    ? `<div class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">No tasks yet.</div>`
                    : tasks.map((item) => `
                                            <button data-task-id="${item.id}" class="w-full text-left rounded-lg border p-3 transition-colors ${selectedTaskId === item.id
                            ? (isDawn ? 'bg-[#f7efe4] border-[#ea9d34]/40' : (isNeon ? 'bg-neon-accent/10 border-cyan-400/50' : 'bg-mysql-teal/10 border-mysql-teal/30'))
                            : (isLight ? 'bg-white border-gray-200 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] hover:bg-[#f7efe4]' : (isNeon ? 'bg-neon-panel/20 border-neon-border/10 hover:bg-neon-accent/5' : 'bg-black/20 border-white/10 hover:bg-white/10')))
                        }">
                                                <div class="flex items-start justify-between gap-2">
                                                    <div class="min-w-0">
                                                        <div class="text-sm font-semibold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-100'))} truncate">${escapeHtml(item.name)}</div>
                                                        <div class="text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400'))} truncate">${escapeHtml(taskTypeLabel(item.taskType))}</div>
                                                        <div class="text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/40' : 'text-gray-400'))} truncate">Owner: ${escapeHtml(item.owner || '-')}</div>
                                                    </div>
                                                    <span class="text-[10px] px-2 py-0.5 rounded-full border ${statusBadgeClass(item.status, isLight, isDawn, isNeon)}">${escapeHtml(item.status)}</span>
                                                </div>
                                                <div class="mt-2 grid grid-cols-2 gap-2 text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                                                    <div>Last run: ${escapeHtml(item.lastRunStatus || '-')}</div>
                                                    <div>Next run: ${escapeHtml(formatDateTime(item.nextRunAt))}</div>
                                                </div>
                                                <div class="mt-1 text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                                                    Updated ${escapeHtml(formatTimeAgo(item.updatedAt))}
                                                </div>
                                            </button>
                                        `).join('')}
                        </div>
                    </div>
                </section>

                <section class="xl:col-span-8 min-h-0 flex flex-col gap-4">
                    <div class="rounded-xl border p-4 ${isLight
                ? 'bg-white border-gray-200'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNeon ? 'bg-neon-panel border-neon-border/40' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#11141a] border-white/10')))}">
                        <div class="flex items-center justify-between mb-3">
                            <div>
                                <h2 class="text-sm font-semibold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-200'))}">${task ? escapeHtml(task.name) : 'Select a Task'}</h2>
                                <p class="text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400'))}">${task ? `Type: ${escapeHtml(taskTypeLabel(task.taskType))}` : 'No task selected.'}</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <button id="task-open-edit-btn" class="px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${isLight
                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20'
            } ${task ? '' : 'opacity-50 pointer-events-none'}">
                                    Edit
                                </button>
                                <button id="task-run-now-btn" class="px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${isLight
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
            } ${task ? '' : 'opacity-50 pointer-events-none'}">
                                    Run Now
                                </button>
                                <button id="task-delete-btn" class="px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${isLight
                ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                : (isNeon ? 'bg-neon-pink/10 border-neon-pink/30 text-neon-pink hover:bg-neon-pink/20' : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20')
            } ${task ? '' : 'opacity-50 pointer-events-none'}">
                                    Delete Task
                                </button>
                            </div>
                        </div>

                        ${task ? `
                            <div class="text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text/70' : 'text-gray-300'))}">
                                ${escapeHtml(task.description || 'No description')}
                            </div>
                        ` : ''}
                    </div>

                    ${isCompositeTask ? `
                        <div class="rounded-xl border p-4 ${isLight
                    ? 'bg-white border-gray-200 shadow-sm'
                    : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNeon ? 'bg-neon-panel border-neon-border/30' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#11141a] border-white/10')))}">
                            <div class="flex items-center justify-between gap-2 mb-3">
                                <div>
                                    <h3 class="text-sm font-semibold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-200'))}">Composite Builder</h3>
                                    <p class="text-[11px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400'))}">
                                        Build step order and dependencies for this task.
                                    </p>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button id="composite-reload-btn" type="button" class="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${isLight
                    ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#f7efe4]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text hover:bg-neon-accent/10' : 'bg-black/20 border-white/10 text-gray-200 hover:bg-white/10'))
                } ${isLoadingCompositeGraph || isSavingCompositeGraph ? 'opacity-60 pointer-events-none' : ''}">
                                        Reload
                                    </button>
                                    <button id="composite-save-btn" type="button" class="px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${compositeCanSave
                    ? (isDawn ? 'bg-[#ea9d34] border-[#ea9d34] text-white hover:bg-[#d18b2f]' : (isNeon ? 'bg-cyan-400 border-cyan-400 text-black shadow-[0_0_15px_rgba(0,243,255,0.4)] hover:bg-cyan-300' : 'bg-mysql-teal border-mysql-teal text-white hover:bg-mysql-teal/90'))
                    : (isLight ? 'bg-gray-100 border-gray-200 text-gray-400' : (isNeon ? 'bg-neon-panel border-neon-border/10 text-neon-text/30' : 'bg-white/5 border-white/10 text-gray-500'))
                } ${compositeCanSave ? '' : 'pointer-events-none'}">
                                        ${isSavingCompositeGraph ? 'Saving...' : 'Save Graph'}
                                    </button>
                                </div>
                            </div>

                            ${isLoadingCompositeGraph
                    ? `<div class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">Loading composite graph...</div>`
                    : `
                                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                        <div class="rounded-lg border p-3 ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/20 bg-neon-panel/20' : 'border-white/10 bg-black/20'))}">
                                            <div class="flex items-center justify-between mb-2">
                                                <h4 class="text-xs font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-200'))}">Steps</h4>
                                                <button id="composite-add-step-btn" type="button" class="px-2 py-1 rounded border text-[11px] ${isLight
                        ? 'text-gray-700 border-gray-200 bg-white hover:bg-gray-100'
                        : (isDawn ? 'text-[#575279] border-[#f2e9e1] bg-[#fffaf3] hover:bg-[#f7efe4]' : (isNeon ? 'text-neon-text border-neon-border/40 bg-neon-panel hover:bg-neon-accent/10' : 'text-gray-200 border-white/15 bg-white/5 hover:bg-white/10'))
                    }">Add Step</button>
                                            </div>
                                            <div class="space-y-2 max-h-64 overflow-auto custom-scrollbar pr-1">
                                                ${compositeDraft.steps.length === 0
                        ? `<div class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">No steps yet.</div>`
                        : compositeDraft.steps.map((step, index) => `
                                                        <div class="rounded-lg border p-2 space-y-2 ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isNeon ? 'border-neon-border/20 bg-neon-panel/40' : 'border-white/10 bg-black/20'))}">
                                                            <div class="flex items-center justify-between gap-2">
                                                                <span class="text-[10px] uppercase tracking-wider ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/50' : 'text-gray-400')}">Step ${index + 1}</span>
                                                                <div class="flex items-center gap-1">
                                                                    <button type="button" data-composite-step-action="move-up" data-step-index="${index}" class="px-1.5 py-0.5 rounded border text-[10px] ${isLight ? 'border-gray-200 text-gray-600 bg-gray-50 hover:bg-gray-100' : 'border-white/10 text-gray-300 bg-white/5 hover:bg-white/10'} ${index === 0 ? 'opacity-40 pointer-events-none' : ''}">Up</button>
                                                                    <button type="button" data-composite-step-action="move-down" data-step-index="${index}" class="px-1.5 py-0.5 rounded border text-[10px] ${isLight ? 'border-gray-200 text-gray-600 bg-gray-50 hover:bg-gray-100' : 'border-white/10 text-gray-300 bg-white/5 hover:bg-white/10'} ${index === compositeDraft.steps.length - 1 ? 'opacity-40 pointer-events-none' : ''}">Down</button>
                                                                    <button type="button" data-composite-step-action="remove" data-step-index="${index}" class="px-1.5 py-0.5 rounded border text-[10px] ${isLight ? 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100' : 'border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500/20'}">Delete</button>
                                                                </div>
                                                            </div>
                                                            <div class="grid grid-cols-2 gap-2">
                                                                <input data-composite-step-field="stepKey" data-step-index="${index}" value="${escapeHtml(step.stepKey)}" placeholder="step key"
                                                                    class="rounded-lg border px-2 py-1.5 text-xs font-mono ${isLight
                                ? 'bg-white border-gray-200 text-gray-700'
                                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-black/20 border-white/10 text-gray-200'))}">
                                                                <select data-composite-step-field="mode" data-step-index="${index}" class="rounded-lg border px-2 py-1.5 text-xs ${isLight
                                ? 'bg-gray-50 border-gray-200 text-gray-700'
                                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                                                    ${COMPOSITE_MODE_OPTIONS.map((option) => `
                                                                        <option value="${option.value}" ${step.mode === option.value ? 'selected' : ''}>${option.label}</option>
                                                                    `).join('')}
                                                                </select>
                                                            </div>
                                                            ${step.mode === 'inline'
                                ? `<select data-composite-step-field="taskType" data-step-index="${index}" class="w-full rounded-lg border px-2 py-1.5 text-xs ${isLight
                                    ? 'bg-gray-50 border-gray-200 text-gray-700'
                                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                                                    ${INLINE_COMPOSITE_TASK_TYPES.map((option) => `
                                                                        <option value="${option.value}" ${step.taskType === option.value ? 'selected' : ''}>${option.label}</option>
                                                                    `).join('')}
                                                                </select>`
                                : `<input data-composite-step-field="referencedTaskId" data-step-index="${index}" value="${escapeHtml(step.referencedTaskId)}" placeholder="Referenced task id"
                                                                    class="w-full rounded-lg border px-2 py-1.5 text-xs font-mono ${isLight
                                    ? 'bg-gray-50 border-gray-200 text-gray-700'
                                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">`}
                                                            <div class="grid grid-cols-2 gap-2">
                                                                <select data-composite-step-field="onError" data-step-index="${index}" class="rounded-lg border px-2 py-1.5 text-xs ${isLight
                                ? 'bg-gray-50 border-gray-200 text-gray-700'
                                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                                                    ${COMPOSITE_STEP_ON_ERROR_OPTIONS.map((option) => `
                                                                        <option value="${option.value}" ${step.onError === option.value ? 'selected' : ''}>On Error: ${option.label}</option>
                                                                    `).join('')}
                                                                </select>
                                                                <label class="flex items-center gap-2 text-xs px-2 ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                                                                    <input data-composite-step-field="enabled" data-step-index="${index}" type="checkbox" ${step.enabled ? 'checked' : ''}>
                                                                    Enabled
                                                                </label>
                                                            </div>
                                                            <textarea data-composite-step-field="payloadText" data-step-index="${index}" rows="3"
                                                                class="w-full rounded-lg border px-2 py-1.5 text-xs font-mono ${isLight
                                ? 'bg-gray-50 border-gray-200 text-gray-700'
                                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">${escapeHtml(step.payloadText)}</textarea>
                                                        </div>
                                                    `).join('')}
                                            </div>
                                        </div>

                                        <div class="rounded-lg border p-3 ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/10 bg-black/20')}">
                                            <div class="flex items-center justify-between mb-2">
                                                <h4 class="text-xs font-semibold ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">Dependencies</h4>
                                                <button id="composite-add-edge-btn" type="button" class="px-2 py-1 rounded border text-[11px] ${isLight
                        ? 'text-gray-700 border-gray-200 bg-white hover:bg-gray-100'
                        : (isDawn ? 'text-[#575279] border-[#f2e9e1] bg-[#fffaf3] hover:bg-[#f7efe4]' : 'text-gray-200 border-white/15 bg-white/5 hover:bg-white/10')
                    }">Add Dependency</button>
                                            </div>

                                            <div class="space-y-2 max-h-64 overflow-auto custom-scrollbar pr-1">
                                                ${compositeDraft.edges.length === 0
                        ? `<div class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">No dependencies yet.</div>`
                        : compositeDraft.edges.map((edge, index) => `
                                                        <div class="rounded-lg border p-2 ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : 'border-white/10 bg-black/20')}">
                                                            <div class="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                                                                <select data-composite-edge-field="fromStepKey" data-edge-index="${index}" class="rounded-lg border px-2 py-1.5 text-xs ${isLight
                                ? 'bg-gray-50 border-gray-200 text-gray-700'
                                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                                                    <option value="">From</option>
                                                                    ${compositeStepKeyOptions.map((stepKey) => `
                                                                        <option value="${escapeHtml(stepKey)}" ${edge.fromStepKey === stepKey ? 'selected' : ''}>${escapeHtml(stepKey)}</option>
                                                                    `).join('')}
                                                                </select>
                                                                <span class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">-></span>
                                                                <select data-composite-edge-field="toStepKey" data-edge-index="${index}" class="rounded-lg border px-2 py-1.5 text-xs ${isLight
                                ? 'bg-gray-50 border-gray-200 text-gray-700'
                                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                                                    <option value="">To</option>
                                                                    ${compositeStepKeyOptions.map((stepKey) => `
                                                                        <option value="${escapeHtml(stepKey)}" ${edge.toStepKey === stepKey ? 'selected' : ''}>${escapeHtml(stepKey)}</option>
                                                                    `).join('')}
                                                                </select>
                                                                <button type="button" data-composite-edge-action="remove" data-edge-index="${index}" class="px-2 py-1 rounded border text-[10px] ${isLight ? 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100' : 'border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500/20'}">Delete</button>
                                                            </div>
                                                            <input data-composite-edge-field="condition" data-edge-index="${index}" value="${escapeHtml(edge.condition)}" placeholder="Condition (optional)"
                                                                class="w-full mt-2 rounded-lg border px-2 py-1.5 text-xs ${isLight
                                ? 'bg-gray-50 border-gray-200 text-gray-700'
                                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                                        </div>
                                                    `).join('')}
                                            </div>
                                        </div>
                                    </div>

                                    ${compositeErrors.length > 0
                        ? `<div class="mt-3 rounded-lg border px-3 py-2 ${isLight ? 'border-red-200 bg-red-50' : 'border-red-500/30 bg-red-500/10'}">
                                            <div class="text-[11px] font-semibold ${isLight ? 'text-red-700' : 'text-red-300'}">
                                                Validation issues (${compositeErrors.length})
                                            </div>
                                            <div class="mt-1 space-y-1">
                                                ${compositeErrors.map((error) => `
                                                    <div class="text-[11px] ${isLight ? 'text-red-600' : 'text-red-200'}">${escapeHtml(error)}</div>
                                                `).join('')}
                                            </div>
                                        </div>`
                        : `<div class="mt-3 text-[11px] ${isLight ? 'text-emerald-600' : 'text-emerald-300'}">Composite graph is valid. You can save.</div>`}
                                `}
                        </div>
                    ` : ''}

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 flex-1">
                        <div class="rounded-xl border p-4 min-h-0 flex flex-col ${isLight
                ? 'bg-white border-gray-200'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNeon ? 'bg-neon-panel border-neon-border/40' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#11141a] border-white/10')))}">
                            <h3 class="text-sm font-semibold mb-3 ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-200'))}">Triggers</h3>

                            <form id="trigger-create-form" class="space-y-2 mb-3 ${task ? '' : 'opacity-50 pointer-events-none'}">
                                <div class="grid grid-cols-2 gap-2">
                                    <select id="trigger-form-type" data-trigger-input="true" class="rounded-lg border px-2 py-2 text-xs ${isLight
                ? 'bg-white border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-black/20 border-white/10 text-gray-200'))}">
                                        ${TRIGGER_TYPE_OPTIONS.map((option) => `
                                            <option value="${option.value}" ${triggerForm.triggerType === option.value ? 'selected' : ''}>${option.label}</option>
                                        `).join('')}
                                    </select>
                                    ${triggerForm.triggerType === 'interval'
                ? `<input id="trigger-form-interval" data-trigger-input="true" type="number" min="1" value="${escapeHtml(String(triggerForm.intervalSeconds))}" placeholder="Interval (s)"
                                        class="rounded-lg border px-2 py-2 text-xs ${isLight
                    ? 'bg-gray-50 border-gray-200 text-gray-700'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">`
                : `<input type="text" disabled value="${triggerForm.triggerType === 'cron' ? 'Cron schedule mode' : 'One-shot schedule mode'}"
                                        class="rounded-lg border px-2 py-2 text-xs ${isLight
                    ? 'bg-gray-100 border-gray-200 text-gray-500'
                    : 'bg-black/30 border-white/10 text-gray-400'}">`}
                                </div>
                                ${triggerForm.triggerType === 'cron'
                ? `<div class="grid grid-cols-[1fr_1fr_auto] gap-2">
                                        <input id="trigger-cron-minute" data-trigger-input="true" value="${escapeHtml(cronBuilder.minute)}" placeholder="Minute (*/15)"
                                            class="rounded-lg border px-2 py-2 text-xs font-mono ${isLight
                    ? 'bg-white border-gray-200 text-gray-700'
                    : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-black/20 border-white/10 text-gray-200'))}">
                                        <input id="trigger-cron-hour" data-trigger-input="true" value="${escapeHtml(cronBuilder.hour)}" placeholder="Hour (* or 9-18)"
                                            class="rounded-lg border px-2 py-2 text-xs font-mono ${isLight
                    ? 'bg-gray-50 border-gray-200 text-gray-700'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                        <button id="trigger-build-cron-btn" type="button" class="px-2 py-2 rounded-lg border text-[11px] font-semibold ${isLight
                    ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#f7efe4]' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10')}">Build</button>
                                    </div>
                                    <input id="trigger-form-cron" data-trigger-input="true" value="${escapeHtml(triggerForm.cronExpression)}" placeholder="Cron (e.g. */30 * * * *)"
                                        class="w-full rounded-lg border px-3 py-2 text-xs font-mono ${isLight
                    ? 'bg-white border-gray-200 text-gray-700'
                    : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-black/20 border-white/10 text-gray-200'))}">`
                : ''}
                                ${triggerForm.triggerType === 'one_shot'
                ? `<input id="trigger-form-run-at" data-trigger-input="true" type="datetime-local" value="${escapeHtml(toLocalDateTimeInput(triggerForm.runAt))}"
                                    class="w-full rounded-lg border px-3 py-2 text-xs ${isLight
                    ? 'bg-white border-gray-200 text-gray-700'
                    : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-black/20 border-white/10 text-gray-200'))}">`
                : ''}
                                <div class="grid grid-cols-2 gap-2">
                                    <input id="trigger-form-timezone" data-trigger-input="true" value="${escapeHtml(triggerForm.timezone)}" placeholder="Timezone"
                                        class="rounded-lg border px-2 py-2 text-xs ${isLight
                ? 'bg-white border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-black/20 border-white/10 text-gray-200'))}">
                                    <select id="trigger-form-misfire" data-trigger-input="true" class="rounded-lg border px-2 py-2 text-xs ${isLight
                ? 'bg-gray-50 border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                        ${MISFIRE_OPTIONS.map((option) => `
                                            <option value="${option.value}" ${triggerForm.misfirePolicy === option.value ? 'selected' : ''}>${option.label}</option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div class="grid grid-cols-2 gap-2">
                                    <input id="trigger-form-retry-attempts" data-trigger-input="true" type="number" min="0" value="${escapeHtml(String(triggerForm.retryMaxAttempts))}" placeholder="Retry attempts"
                                        class="rounded-lg border px-2 py-2 text-xs ${isLight
                ? 'bg-gray-50 border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                    <input id="trigger-form-retry-backoff" data-trigger-input="true" type="number" min="0" value="${escapeHtml(String(triggerForm.retryBackoffMs))}" placeholder="Backoff ms"
                                        class="rounded-lg border px-2 py-2 text-xs ${isLight
                ? 'bg-white border-gray-200 text-gray-700'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-black/20 border-white/10 text-gray-200'))}">
                                </div>
                                <label class="flex items-center gap-2 text-xs ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                                    <input id="trigger-form-enabled" data-trigger-input="true" type="checkbox" ${triggerForm.enabled ? 'checked' : ''}>
                                    Enabled
                                </label>
                                <div class="rounded-lg border px-2 py-2 ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/20 bg-neon-panel/20' : 'border-white/10 bg-black/20'))}">
                                    <div class="text-[10px] uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Preview</div>
                                    ${triggerPreview.error
                ? `<div class="mt-1 text-[11px] ${isLight ? 'text-red-600' : 'text-red-300'}">${escapeHtml(triggerPreview.error)}</div>`
                : `<div class="mt-1 space-y-1">
                                            ${triggerPreview.values.map((value, index) => `
                                                <div class="text-[11px] ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-200')}">
                                                    ${index + 1}. ${escapeHtml(formatDateTime(value.toISOString()))}
                                                </div>
                                            `).join('')}
                                        </div>`}
                                </div>
                                <button type="submit" class="w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors ${isDawn ? 'bg-[#ea9d34] hover:bg-[#d18b2f]' : 'bg-mysql-teal hover:bg-mysql-teal/90'}">
                                    Add Trigger
                                </button>
                            </form>

                            <div class="flex-1 min-h-0 overflow-auto custom-scrollbar space-y-2">
                                ${isLoadingDetails
                ? `<div class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">Loading triggers...</div>`
                : triggers.length === 0
                    ? `<div class="text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}">No triggers.</div>`
                    : triggers.map((trigger) => `
                                            <div class="rounded-lg border p-3 ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/20 bg-neon-panel/20' : 'border-white/10 bg-black/20'))}">
                                                <div class="flex items-center justify-between gap-2">
                                                    <div class="text-xs font-semibold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-gray-100')}">${escapeHtml(triggerTypeLabel(trigger.triggerType))}</div>
                                                    <button data-trigger-id="${trigger.id}" class="text-[11px] px-2 py-1 rounded border ${isLight ? 'text-red-600 border-red-200 bg-red-50 hover:bg-red-100' : 'text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/20'}">Delete</button>
                                                </div>
                                                <div class="mt-1 text-[11px] ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                                                    Next: ${escapeHtml(formatDateTime(trigger.nextRunAt))}<br>
                                                    Last: ${escapeHtml(formatDateTime(trigger.lastRunAt))}
                                                </div>
                                                ${trigger.cronExpression ? `<div class="mt-1 text-[11px] font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'}">${escapeHtml(trigger.cronExpression)}</div>` : ''}
                                                ${trigger.intervalSeconds ? `<div class="mt-1 text-[11px] ${isLight ? 'text-gray-700' : 'text-gray-300'}">Interval: ${escapeHtml(String(trigger.intervalSeconds))}s</div>` : ''}
                                            </div>
                                        `).join('')}
                            </div>
                        </div>

                        <div class="rounded-xl border p-4 min-h-0 flex flex-col ${isLight
                ? 'bg-white border-gray-200'
                : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNeon ? 'bg-neon-panel border-neon-border/40' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#11141a] border-white/10')))}">
                            <div class="flex items-center justify-between mb-3">
                                <h3 class="text-sm font-semibold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-200'))}">Runs & Logs</h3>
                                <div class="flex items-center gap-2">
                                    <button id="task-cancel-run-btn" class="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${isLight
                ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
            } ${(canCancelRun && !isRunActionBusy) ? '' : 'opacity-50 pointer-events-none'}">
                                        Cancel
                                    </button>
                                    <button id="task-retry-run-btn" class="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${isLight
                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20'
            } ${(canRetryRun && !isRunActionBusy) ? '' : 'opacity-50 pointer-events-none'}">
                                        Retry
                                    </button>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0 flex-1">
                                <div class="min-h-0 overflow-auto custom-scrollbar space-y-2">
                                    ${isLoadingDetails
                ? `<div class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">Loading runs...</div>`
                : runs.length === 0
                    ? `<div class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">No runs yet.</div>`
                    : runs.map((run) => `
                                                <button data-run-id="${run.id}" class="w-full text-left rounded-lg border p-3 ${selectedRunId === run.id
                            ? (isDawn ? 'bg-[#f7efe4] border-[#ea9d34]/40' : (isNeon ? 'bg-neon-accent/10 border-cyan-400/50' : 'bg-mysql-teal/10 border-mysql-teal/30'))
                            : (isLight ? 'bg-white border-gray-200 hover:bg-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] hover:bg-[#f7efe4]' : (isNeon ? 'bg-neon-panel/20 border-neon-border/10 hover:bg-neon-accent/5' : 'bg-black/20 border-white/10 hover:bg-white/10')))
                        }">
                                                    <div class="flex items-center justify-between gap-2">
                                                        <span class="text-[11px] font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'}">${escapeHtml(run.id.slice(0, 8))}</span>
                                                        <span class="text-[10px] px-2 py-0.5 rounded-full border ${runStatusBadgeClass(run.status)}">${escapeHtml(run.status)}</span>
                                                    </div>
                                                    <div class="mt-1 text-[10px] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">
                                                        ${escapeHtml(formatTimeAgo(run.startedAt))}
                                                    </div>
                                                </button>
                                            `).join('')}
                                </div>
                                <div class="min-h-0 overflow-auto custom-scrollbar rounded-lg border p-3 ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/20 bg-neon-panel/20' : 'border-white/10 bg-black/20'))}">
                                    ${selectedRunId && compositeStepRuns.length > 0
                ? `<div class="mb-3 pb-2 border-b ${isLight ? 'border-gray-200' : 'border-white/10'}">
                                            <div class="text-[10px] uppercase tracking-wider mb-2 ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/50' : 'text-gray-400')}">Composite Steps</div>
                                            <div class="space-y-1">
                                                ${compositeStepRuns.map((stepRun) => `
                                                    <div class="flex items-center justify-between text-[11px] ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text/70' : 'text-gray-300'))}">
                                                        <span class="font-mono">${escapeHtml(stepRun.stepKey)}</span>
                                                        <span class="px-2 py-0.5 rounded-full border ${runStatusBadgeClass(stepRun.status)}">${escapeHtml(stepRun.status)}</span>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        </div>`
                : ''}
                                    ${selectedRunId
                ? (runLogs.length === 0
                    ? `<div class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">No logs for selected run.</div>`
                    : runLogs.map((log) => `
                                                    <div class="mb-2 pb-2 border-b last:border-b-0 ${isLight ? 'border-gray-200' : (isNeon ? 'border-neon-border/10' : 'border-white/10')}">
                                                        <div class="flex items-center justify-between">
                                                            <span class="text-[10px] uppercase tracking-wider ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-pink' : 'text-gray-400')}">${escapeHtml(log.level)}</span>
                                                            <span class="text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-500'}">${escapeHtml(formatDateTime(log.createdAt))}</span>
                                                        </div>
                                                        <div class="text-xs mt-1 ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-300'))}">${escapeHtml(log.message)}</div>
                                                    </div>
                                                `).join(''))
                : `<div class="text-xs ${isLight ? 'text-gray-500' : (isNeon ? 'text-neon-text/40' : 'text-gray-400')}">Select a run to inspect logs.</div>`}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
            ${isTaskDrawerOpen
                ? `<div id="task-drawer-overlay" class="fixed inset-0 z-[200]">
                        <div class="absolute inset-0 bg-black/50"></div>
                        <aside class="absolute right-0 top-0 h-full w-full max-w-xl border-l p-4 overflow-auto ${isLight
                    ? 'bg-white border-gray-200'
                    : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNeon ? 'bg-neon-bg border-neon-border/40' : 'bg-[#0f1319] border-white/10'))}">
                            <div class="flex items-center justify-between mb-3">
                                <h3 class="text-sm font-semibold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-100'))}">
                                    ${taskDrawerMode === 'edit' ? 'Edit Task' : 'Create Task'}
                                </h3>
                                <button id="task-drawer-close-btn" class="px-2 py-1 rounded border text-[11px] ${isLight
                    ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] hover:bg-[#f7efe4]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text hover:bg-neon-accent/10' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'))}">
                                    Close
                                </button>
                            </div>

                            <form id="task-upsert-form" class="space-y-3">
                                <input id="task-form-name" placeholder="Task name" value="${escapeHtml(taskForm.name)}"
                                    class="w-full rounded-lg border px-3 py-2 text-sm ${isLight
                    ? 'bg-white border-gray-200 text-gray-800'
                    : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel border-neon-border/40 text-neon-text' : 'bg-black/20 border-white/10 text-gray-200'))}">

                                <textarea id="task-form-description" rows="2" placeholder="Description"
                                    class="w-full rounded-lg border px-3 py-2 text-sm ${isLight
                    ? 'bg-gray-50 border-gray-200 text-gray-800'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">${escapeHtml(taskForm.description)}</textarea>

                                <div class="grid grid-cols-2 gap-2">
                                    <select id="task-form-type" class="rounded-lg border px-2 py-2 text-xs ${isLight
                    ? 'bg-gray-50 border-gray-200 text-gray-700'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                        ${TASK_TYPE_OPTIONS.map((option) => `
                                            <option value="${option.value}" ${taskForm.taskType === option.value ? 'selected' : ''}>${option.label}</option>
                                        `).join('')}
                                    </select>
                                    <select id="task-form-status" class="rounded-lg border px-2 py-2 text-xs ${isLight
                    ? 'bg-gray-50 border-gray-200 text-gray-700'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                        ${TASK_STATUS_OPTIONS.map((option) => `
                                            <option value="${option.value}" ${taskForm.status === option.value ? 'selected' : ''}>${option.label}</option>
                                        `).join('')}
                                    </select>
                                </div>

                                <div class="grid grid-cols-2 gap-2">
                                    <input id="task-form-owner" placeholder="Owner" value="${escapeHtml(taskForm.owner)}"
                                        class="rounded-lg border px-3 py-2 text-xs ${isLight
                    ? 'bg-gray-50 border-gray-200 text-gray-800'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                    <input id="task-form-tags" placeholder="tags,comma,separated" value="${escapeHtml(taskForm.tags)}"
                                        class="rounded-lg border px-3 py-2 text-xs ${isLight
                    ? 'bg-gray-50 border-gray-200 text-gray-800'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">
                                </div>

                                <textarea id="task-form-payload" rows="10"
                                    class="w-full rounded-lg border px-3 py-2 text-xs font-mono ${isLight
                    ? 'bg-gray-50 border-gray-200 text-gray-800'
                    : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-200')}">${escapeHtml(taskForm.payload)}</textarea>

                                <button type="submit" class="w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors ${isDawn ? 'bg-[#ea9d34] hover:bg-[#d18b2f]' : 'bg-mysql-teal hover:bg-mysql-teal/90'} ${isSubmittingTaskForm ? 'opacity-70 pointer-events-none' : ''}">
                                    ${isSubmittingTaskForm
                    ? 'Saving...'
                    : (taskDrawerMode === 'edit' ? 'Save Changes' : 'Create Task')}
                                </button>
                            </form>
                        </aside>
                    </div>`
                : ''}
        `;

        bindEvents();
    };

    const onThemeChange = (event) => {
        theme = event.detail.theme;
        render();
    };
    window.addEventListener('themechange', onThemeChange);
    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    refreshTasks({ keepSelection: false });

    return container;
}
