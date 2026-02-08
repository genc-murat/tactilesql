import { ThemeManager } from '../../../utils/ThemeManager.js';
import { highlightSQL } from '../../../utils/SqlHighlighter.js';
import { AiService } from '../../../utils/AiService.js';
import { toastError, toastSuccess } from '../../../utils/Toast.js';
import { SchemaTrackerApi } from '../../../api/schemaTracker.js';
import { Dialog } from '../../UI/Dialog.js';
import { invoke } from '@tauri-apps/api/core';

export function SchemaDiffViewer({ diff, migrationScript, breakingChanges, onGenerateMigration, connectionId, baseSnapshotId = null, targetSnapshotId = null, dbType = null }) {
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic';
    const isEmber = theme === 'ember';
    const isAurora = theme === 'aurora';
    const isNeon = theme === 'neon';

    const container = document.createElement('div');
    container.className = `flex-1 h-full flex flex-col overflow-hidden`;

    if (!diff) {
        container.innerHTML = `
            <div class="flex-1 flex flex-col items-center justify-center opacity-40 ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-500'))}">
                <span class="material-symbols-outlined text-6xl mb-4 ${isNeon ? 'text-neon-text/20' : ''}">compare_arrows</span>
                <p class="text-lg font-medium ${isNeon ? 'text-neon-text' : ''}">Select a snapshot to compare</p>
                <p class="text-sm mt-2">Compare with the previous version to see changes.</p>
            </div>
        `;
        return container;
    }

    const { new_tables, dropped_tables, modified_tables } = diff;
    const hasChanges = new_tables.length > 0 || dropped_tables.length > 0 || modified_tables.length > 0;

    let impactWarnings = null;
    let loadingImpact = false;
    let aiImpactAnalysis = '';
    let aiImpactError = '';
    let loadingAiImpact = false;
    let loadingMigrationPlan = false;
    let migrationPlanError = '';
    let renderScriptPanel = () => { };

    const normalizeDbType = (value) => {
        const normalized = String(value || '').toLowerCase();
        return normalized === 'postgres' || normalized === 'postgresql' ? 'postgresql' : 'mysql';
    };

    const storedConnection = JSON.parse(localStorage.getItem('activeConnection') || '{}');
    const resolvedDbType = normalizeDbType(dbType || storedConnection.dbType || storedConnection.db_type);
    let migrationStrategy = resolvedDbType === 'postgresql' ? 'postgres_concurrently' : 'native';
    let lockGuardEnabled = true;
    let migrationPlan = {
        script: migrationScript || '',
        warnings: [],
        external_commands: [],
        unsupported_statements: [],
        strategy: migrationStrategy
    };

    const parseSnapshotId = (value) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };

    const baseSnapshotIdNum = parseSnapshotId(baseSnapshotId);
    const targetSnapshotIdNum = parseSnapshotId(targetSnapshotId);
    const hasSnapshotPair = Boolean(connectionId && baseSnapshotIdNum && targetSnapshotIdNum);

    const escapeHtml = (value = '') => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getAiSettings = () => {
        const provider = localStorage.getItem('ai_provider') || 'openai';

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

    const getConnectionContext = () => {
        if (!connectionId) {
            return storedConnection;
        }

        return { ...storedConnection, id: connectionId };
    };

    const runAiImpactAnalysis = async () => {
        if (!hasChanges || loadingAiImpact) return;

        const { provider, apiKey, model } = getAiSettings();
        if (provider !== 'local' && !apiKey) {
            toastError(`Missing ${provider.toUpperCase()} API key. Configure it in Settings > AI Assistant.`);
            return;
        }

        loadingAiImpact = true;
        aiImpactError = '';
        aiImpactAnalysis = '';
        renderHeader();

        try {
            const analysis = await AiService.analyzeSchemaImpact(provider, apiKey, model, {
                connection: getConnectionContext(),
                diff,
                breakingChanges: breakingChanges || [],
                impactWarnings: impactWarnings || []
            });

            aiImpactAnalysis = analysis;
            aiImpactError = '';

            if (hasSnapshotPair) {
                try {
                    await SchemaTrackerApi.saveAiImpactReport({
                        connectionId,
                        baseSnapshotId: baseSnapshotIdNum,
                        targetSnapshotId: targetSnapshotIdNum,
                        provider,
                        model,
                        analysisText: analysis
                    });
                    toastSuccess('AI impact analysis completed and saved.');
                } catch (saveError) {
                    console.error('Failed to save AI impact report:', saveError);
                    toastError(`AI analysis generated but could not be saved: ${saveError?.message || saveError}`);
                }
            } else {
                toastSuccess('AI impact analysis completed.');
            }
        } catch (error) {
            aiImpactError = error?.message || 'Unknown AI analysis error';
            toastError(`AI impact analysis failed: ${aiImpactError}`);
        } finally {
            loadingAiImpact = false;
            renderHeader();
        }
    };

    const loadSavedAiImpactReport = async () => {
        if (!hasSnapshotPair) return;

        try {
            const report = await SchemaTrackerApi.getAiImpactReport(
                connectionId,
                baseSnapshotIdNum,
                targetSnapshotIdNum
            );
            if (report?.analysis_text) {
                aiImpactAnalysis = report.analysis_text;
                aiImpactError = '';
                renderHeader();
            }
        } catch (error) {
            console.error('Failed to load saved AI impact report:', error);
        }
    };

    const loadMigrationPlan = async () => {
        if (!hasChanges) return;

        loadingMigrationPlan = true;
        migrationPlanError = '';
        renderHeader();
        renderScriptPanel();

        try {
            const plan = await SchemaTrackerApi.generateMigrationPlan(
                diff,
                resolvedDbType,
                migrationStrategy
            );
            migrationPlan = {
                script: plan?.script || migrationScript || '',
                warnings: Array.isArray(plan?.warnings) ? plan.warnings : [],
                external_commands: Array.isArray(plan?.external_commands) ? plan.external_commands : [],
                unsupported_statements: Array.isArray(plan?.unsupported_statements) ? plan.unsupported_statements : [],
                strategy: plan?.strategy || migrationStrategy
            };
        } catch (error) {
            migrationPlanError = error?.message || String(error);
            migrationPlan = {
                script: migrationScript || '',
                warnings: [],
                external_commands: [],
                unsupported_statements: [],
                strategy: migrationStrategy
            };
        } finally {
            loadingMigrationPlan = false;
            renderHeader();
            renderScriptPanel();
        }
    };

    // Header / Stats
    const header = document.createElement('div');
    header.className = `px-6 py-4 border-b flex flex-col gap-4 transition-colors duration-300 ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isNeon ? 'border-neon-border/30 bg-neon-panel' : (isOceanic ? 'border-[#4C566A] bg-[#3B4252]' : (isEmber ? 'border-[#2c1c27] bg-[#1d141c]' : (isAurora ? 'border-[#1b2e33] bg-[#0f1a1d]' : 'border-white/5 bg-[#1a1d23]')))))}`;

    const renderHeader = () => {
        const statsHtml = `
            <div class="flex gap-6">
                <div class="flex flex-col">
                    <span class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/50' : 'text-gray-500'))}">New Tables</span>
                    <span class="text-2xl font-light ${new_tables.length > 0 ? (isNeon ? 'text-cyan-400' : 'text-emerald-400') : 'opacity-30'}">${new_tables.length}</span>
                </div>
                <div class="flex flex-col">
                    <span class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/50' : 'text-gray-500'))}">Modified</span>
                    <span class="text-2xl font-light ${modified_tables.length > 0 ? (isDawn ? 'text-[#ea9d34]' : (isNeon ? 'text-amber-400' : 'text-amber-400')) : 'opacity-30'}">${modified_tables.length}</span>
                </div>
                <div class="flex flex-col">
                    <span class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/50' : 'text-gray-500'))}">Dropped</span>
                    <span class="text-2xl font-light ${dropped_tables.length > 0 ? (isNeon ? 'text-neon-pink' : 'text-red-400') : 'opacity-30'}">${dropped_tables.length}</span>
                </div>
            </div>
        `;

        // Impact Alert
        let impactHtml = '';
        if (loadingImpact) {
            impactHtml = `
                <div class="px-3 py-2 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center gap-2 max-w-xl animate-pulse">
                    <span class="material-symbols-outlined text-sm animate-spin">sync</span>
                    <span class="text-xs font-bold">Checking downstream impact...</span>
                </div>
             `;
        } else if (impactWarnings && impactWarnings.length > 0) {
            impactHtml = `
                <div class="px-3 py-2 rounded ${isDawn ? 'bg-[#ea9d34]/10 border-[#ea9d34]/20 text-[#ea9d34]' : 'bg-amber-500/10 border-amber-500/20 text-amber-500'} flex items-start gap-2 max-w-xl">
                    <span class="material-symbols-outlined text-lg">warning</span>
                    <div>
                        <h4 class="text-xs font-bold uppercase">Impact Analysis Warning</h4>
                        <ul class="text-[10px] list-disc list-inside mt-1 opacity-80">
                            ${impactWarnings.map((w) => `<li>${escapeHtml(w.message || 'Unknown impact warning')}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            `;
        }

        // Breaking Changes Alert
        let alertHtml = '';
        if (breakingChanges && breakingChanges.length > 0) {
            alertHtml = `
                <div class="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-red-500 flex items-start gap-2 max-w-xl">
                    <span class="material-symbols-outlined text-lg">error</span>
                    <div>
                        <h4 class="text-xs font-bold uppercase">Breaking Changes Detected</h4>
                        <ul class="text-[10px] list-disc list-inside mt-1 opacity-80">
                            ${breakingChanges.map((change) => `<li>${escapeHtml(change.description || 'Unknown breaking change')}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            `;
        }

        let aiImpactHtml = '';
        if (loadingAiImpact) {
            aiImpactHtml = `
                <div class="px-3 py-2 rounded bg-mysql-teal/10 border border-mysql-teal/20 text-mysql-teal flex items-center gap-2 max-w-3xl animate-pulse">
                    <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    <span class="text-xs font-bold">AI is analyzing schema impact...</span>
                </div>
            `;
        } else if (aiImpactAnalysis) {
            aiImpactHtml = `
                <div class="px-3 py-3 rounded ${isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-bg border-cyan-400/20 text-neon-text' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'))} border max-w-4xl shadow-inner shadow-black/20">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="material-symbols-outlined text-sm ${isNeon ? 'text-cyan-400' : ''}">psychology</span>
                        <h4 class="text-xs font-bold uppercase ${isNeon ? 'text-cyan-400' : ''}">AI Impact Analysis</h4>
                    </div>
                    <pre class="text-[11px] whitespace-pre-wrap leading-relaxed font-mono max-h-64 overflow-y-auto custom-scrollbar pr-2">${escapeHtml(aiImpactAnalysis)}</pre>
                </div>
            `;
        } else if (aiImpactError) {
            aiImpactHtml = `
                <div class="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2 max-w-3xl">
                    <span class="material-symbols-outlined text-sm">error</span>
                    <span class="text-xs">${escapeHtml(aiImpactError)}</span>
                </div>
            `;
        }

        let migrationPlanHtml = '';
        if (loadingMigrationPlan) {
            migrationPlanHtml = `
                <div class="px-3 py-2 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center gap-2 max-w-3xl animate-pulse">
                    <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    <span class="text-xs font-bold">Regenerating migration plan...</span>
                </div>
            `;
        } else if (migrationPlanError) {
            migrationPlanHtml = `
                <div class="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2 max-w-3xl">
                    <span class="material-symbols-outlined text-sm">error</span>
                    <span class="text-xs">${escapeHtml(migrationPlanError)}</span>
                </div>
            `;
        } else if (Array.isArray(migrationPlan?.warnings) && migrationPlan.warnings.length > 0) {
            const highCount = migrationPlan.warnings.filter((w) => String(w.severity || '').toLowerCase() === 'high').length;
            migrationPlanHtml = `
                <div class="px-3 py-2 rounded ${highCount > 0 ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-amber-500/10 border-amber-500/20 text-amber-500'} border flex items-center gap-2 max-w-3xl">
                    <span class="material-symbols-outlined text-sm">policy_alert</span>
                    <span class="text-xs font-bold">Lock Risk Warnings: ${migrationPlan.warnings.length}${highCount > 0 ? ` (high: ${highCount})` : ''}</span>
                </div>
            `;
        }

        const hasExternalCommands = Array.isArray(migrationPlan?.external_commands) && migrationPlan.external_commands.length > 0;
        const copyLabel = hasExternalCommands ? 'Copy OSC Commands' : 'Copy Migration Script';

        header.innerHTML = `
            <div class="flex justify-between items-start">
                ${statsHtml}
                <div>
                    <div class="flex flex-col items-end gap-2">
                        <button id="analyze-impact-ai-btn" class="px-3 py-1.5 rounded transition-all font-bold flex items-center gap-1.5 ${isDawn ? 'bg-[#ea9d34]/10 text-[#ea9d34] hover:bg-[#ea9d34]/20' : 'bg-mysql-teal/10 text-mysql-teal hover:bg-mysql-teal/20'} text-xs ${(!hasChanges || loadingAiImpact) ? 'opacity-60 cursor-not-allowed' : ''}" ${(!hasChanges || loadingAiImpact) ? 'disabled' : ''}>
                            <span class="material-symbols-outlined text-sm ${loadingAiImpact ? 'animate-spin' : ''}">${loadingAiImpact ? 'progress_activity' : 'psychology'}</span>
                            ${loadingAiImpact ? 'Analyzing...' : 'Analyze Impact with AI'}
                        </button>
                        ${hasChanges ? `
                             <button id="copy-script-btn" class="px-3 py-1.5 rounded transition-all font-bold flex items-center gap-1.5 ${isDawn ? 'bg-[#ea9d34]/10 text-[#ea9d34] hover:bg-[#ea9d34]/20' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'} text-xs ${loadingMigrationPlan ? 'opacity-60 cursor-not-allowed' : ''}" ${loadingMigrationPlan ? 'disabled' : ''}>
                                <span class="material-symbols-outlined text-sm">content_copy</span> ${copyLabel}
                             </button>
                            <span class="text-[10px] opacity-40">Strategy-aware</span>
                        ` : ''}
                    </div>
                </div>
            </div>
            ${impactHtml}
            ${alertHtml}
            ${migrationPlanHtml}
            ${aiImpactHtml}
        `;

        header.querySelector('#analyze-impact-ai-btn')?.addEventListener('click', runAiImpactAnalysis);
        header.querySelector('#copy-script-btn')?.addEventListener('click', async () => {
            const warnings = Array.isArray(migrationPlan?.warnings) ? migrationPlan.warnings : [];
            const highWarnings = warnings.filter((warning) => String(warning.severity || '').toLowerCase() === 'high');

            if (lockGuardEnabled && highWarnings.length > 0) {
                const warningPreview = highWarnings
                    .slice(0, 5)
                    .map((warning) => `- ${warning.message || 'High lock risk'}`)
                    .join('\n');
                const proceed = await Dialog.confirm(
                    `High lock risk warnings detected.\n\n${warningPreview}\n\nCopy output anyway?`,
                    'Lock Guard'
                );
                if (!proceed) return;
            }

            const copyText = hasExternalCommands
                ? migrationPlan.external_commands.join('\n')
                : (migrationPlan?.script || migrationScript || '');
            if (!copyText.trim()) {
                toastError('No migration output available to copy.');
                return;
            }

            try {
                await navigator.clipboard.writeText(copyText);
                toastSuccess(hasExternalCommands ? 'OSC command plan copied.' : 'Migration script copied.');
            } catch (error) {
                toastError(`Failed to copy migration output: ${error?.message || error}`);
            }
        });
    };

    container.appendChild(header);

    // Main Content
    const content = document.createElement('div');
    content.className = 'flex-1 flex overflow-hidden';

    // Left: Visual Diff List
    const diffList = document.createElement('div');
    diffList.className = `flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 transition-colors duration-300 ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNeon ? 'bg-neon-bg' : (isOceanic ? 'bg-[#2E3440]' : (isEmber ? 'bg-[#140c12]' : (isAurora ? 'bg-[#0b1214]' : 'bg-[#0f1115]')))))}`;

    if (!hasChanges) {
        diffList.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full opacity-40 ${isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : 'text-gray-500')}">
                <span class="material-symbols-outlined text-4xl mb-2 text-emerald-500">check_circle</span>
                <p>No changes detected</p>
            </div>
        `;
    } else {
        new_tables.forEach(table => {
            diffList.appendChild(createDiffCard('create', table.name, table.columns.map(c => `+ ${c.name} (${c.column_type})`)));
        });
        dropped_tables.forEach(table => {
            diffList.appendChild(createDiffCard('drop', table.name, table.columns.map(c => `- ${c.name}`)));
        });
        modified_tables.forEach(tableDiff => {
            const changes = [];
            tableDiff.new_columns.forEach(c => changes.push(`+ Column: ${c.name} (${c.column_type})`));
            tableDiff.dropped_columns.forEach(c => changes.push(`- Column: ${c.name}`));
            tableDiff.modified_columns.forEach(c => {
                c.changes.forEach(change => {
                    let desc = `~ Column: ${c.column_name}: `;
                    if (change.type_changed) desc += `Type ${change.type_changed.old} -> ${change.type_changed.new}`;
                    else if (change.nullable_changed) desc += `Nullable ${change.nullable_changed.old} -> ${change.nullable_changed.new}`;
                    else desc += JSON.stringify(change);
                    changes.push(desc);
                });
            });
            tableDiff.new_indexes.forEach(i => changes.push(`+ Index: ${i.name}`));
            tableDiff.dropped_indexes.forEach(i => changes.push(`- Index: ${i.name}`));
            diffList.appendChild(createDiffCard('alter', tableDiff.table_name, changes));
        });
    }
    content.appendChild(diffList);

    // Right: Migration Script Preview
    if (hasChanges || migrationScript) {
        const scriptPanel = document.createElement('div');
        scriptPanel.className = `w-1/3 border-l transition-colors duration-300 ${isLight ? 'border-gray-200 bg-white' : (isDawn ? 'border-[#f2e9e1] bg-[#fffaf3]' : (isNeon ? 'border-neon-border/30 bg-neon-panel' : (isOceanic ? 'border-[#4C566A] bg-[#3B4252]' : (isEmber ? 'border-[#2c1c27] bg-[#1d141c]' : (isAurora ? 'border-[#1b2e33] bg-[#0f1a1d]' : 'border-white/5 bg-[#0b0d10]')))))} flex flex-col font-mono text-xs overflow-hidden`;

        renderScriptPanel = () => {
            const strategyOptions = resolvedDbType === 'postgresql'
                ? `
                    <option value="postgres_concurrently" ${migrationStrategy === 'postgres_concurrently' ? 'selected' : ''}>Indexes: CONCURRENTLY</option>
                    <option value="native" ${migrationStrategy === 'native' ? 'selected' : ''}>Standard DDL</option>
                `
                : `
                    <option value="native" ${migrationStrategy === 'native' ? 'selected' : ''}>Native DDL</option>
                    <option value="pt_osc" ${migrationStrategy === 'pt_osc' ? 'selected' : ''}>pt-online-schema-change plan</option>
                    <option value="gh_ost" ${migrationStrategy === 'gh_ost' ? 'selected' : ''}>gh-ost plan</option>
                `;

            const effectiveScript = migrationPlan?.script || migrationScript || '-- Migration script is not available.';
            const warnings = Array.isArray(migrationPlan?.warnings) ? migrationPlan.warnings : [];
            const externalCommands = Array.isArray(migrationPlan?.external_commands) ? migrationPlan.external_commands : [];
            const isExternalOscMode = resolvedDbType === 'mysql' && migrationStrategy !== 'native';

            const strategyNote = isExternalOscMode
                ? `<div class="mb-3 px-3 py-2 rounded border ${isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : (isDawn ? 'bg-[#ea9d34]/10 border-[#ea9d34]/20 text-[#ea9d34]' : 'bg-blue-500/10 border-blue-500/20 text-blue-300')}">
                        External OSC strategy selected. Generated commands should run in shell; SQL is informational.
                   </div>`
                : (resolvedDbType === 'postgresql' && migrationStrategy === 'postgres_concurrently'
                    ? `<div class="mb-3 px-3 py-2 rounded border ${isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : (isDawn ? 'bg-[#286983]/10 border-[#286983]/20 text-[#286983]' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300')}">
                            PostgreSQL index DDL is emitted with CONCURRENTLY to reduce blocking risk.
                       </div>`
                    : '');

            const warningHtml = warnings.length > 0
                ? `<div class="mb-3 space-y-2">
                        ${warnings.map((warning) => {
                    const severity = String(warning.severity || 'low').toLowerCase();
                    const severityClass = severity === 'high'
                        ? (isLight ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-500/10 border-red-500/20 text-red-400')
                        : severity === 'medium'
                            ? (isLight ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-amber-500/10 border-amber-500/20 text-amber-400')
                            : (isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/10 border-blue-500/20 text-blue-300');
                    const icon = severity === 'high' ? 'error' : (severity === 'medium' ? 'warning' : 'info');
                    return `
                                <div class="px-3 py-2 rounded border ${severityClass} flex items-start gap-2 text-[10px] leading-relaxed">
                                    <span class="material-symbols-outlined text-[14px]">${icon}</span>
                                    <span>${escapeHtml(warning.message || '')}</span>
                                </div>
                            `;
                }).join('')}
                   </div>`
                : '';

            const externalCommandsHtml = externalCommands.length > 0
                ? `<div class="mb-3 rounded border ${isLight ? 'bg-gray-50 border-gray-200 text-gray-700' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-white/5 border-white/10 text-gray-300')}">
                        <div class="px-3 py-2 border-b ${isLight ? 'border-gray-200 text-gray-600' : (isDawn ? 'border-[#f2e9e1] text-[#797593]' : 'border-white/10 text-gray-400')} text-[10px] uppercase tracking-widest font-bold">External OSC Commands</div>
                        <pre class="p-3 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(externalCommands.join('\n'))}</pre>
                   </div>`
                : '';

            scriptPanel.innerHTML = `
                <div class="px-4 py-2 border-b ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isNeon ? 'border-neon-border/20 bg-neon-panel' : (isOceanic ? 'border-[#4C566A] bg-[#2E3440]' : (isEmber ? 'border-[#2c1c27] bg-[#140c12]' : (isAurora ? 'border-[#1b2e33] bg-[#0b1214]' : 'border-white/5 bg-black/20')))))}">
                    <div class="flex justify-between items-center">
                        <span class="font-bold opacity-50 ${isLight || isDawn ? 'text-gray-600' : 'text-gray-400'} uppercase">MIGRATION SQL</span>
                        <span class="text-[10px] font-bold ${isLight || isDawn ? 'text-gray-500' : 'text-gray-400'} uppercase">${resolvedDbType}</span>
                    </div>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                        <label class="text-[10px] uppercase tracking-widest ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Strategy</label>
                        <select id="migration-strategy-select" class="px-2 py-1 rounded border text-[10px] ${isLight ? 'bg-white border-gray-200 text-gray-700' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-white/5 border-white/10 text-gray-200')}">
                            ${strategyOptions}
                        </select>
                        <label class="inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] uppercase tracking-widest ${isLight ? 'bg-white border-gray-200 text-gray-600' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-white/5 border-white/10 text-gray-300')}">
                            <input id="migration-lock-guard-toggle" type="checkbox" class="w-3 h-3" ${lockGuardEnabled ? 'checked' : ''} />
                            Lock Guard
                        </label>
                    </div>
                </div>
                <div class="flex-1 overflow-auto p-4 custom-scrollbar">
                    ${strategyNote}
                    ${warningHtml}
                    ${externalCommandsHtml}
                    ${loadingMigrationPlan
                    ? `<div class="text-[11px] ${isLight ? 'text-gray-500' : 'text-gray-400'} flex items-center gap-2"><span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>Generating migration plan...</div>`
                    : `<pre class="${isLight || isDawn ? 'text-gray-700' : 'text-gray-300'} leading-relaxed">${highlightSQL(effectiveScript, theme)}</pre>`}
                </div>
            `;

            scriptPanel.querySelector('#migration-strategy-select')?.addEventListener('change', (event) => {
                const nextStrategy = event.target.value;
                if (nextStrategy === migrationStrategy) return;
                migrationStrategy = nextStrategy;
                loadMigrationPlan();
            });

            scriptPanel.querySelector('#migration-lock-guard-toggle')?.addEventListener('change', (event) => {
                lockGuardEnabled = Boolean(event.target.checked);
                renderHeader();
            });
        };

        content.appendChild(scriptPanel);
        renderScriptPanel();
    }

    container.appendChild(content);
    renderHeader();
    loadSavedAiImpactReport();
    if (hasChanges) {
        loadMigrationPlan();
    }

    // Check Impact
    if (hasChanges) {
        loadingImpact = true;
        renderHeader();
        const activeConn = connectionId ? { id: connectionId } : JSON.parse(localStorage.getItem('activeConnection') || '{}');
        if (activeConn.id) {
            invoke('check_impact', { connectionId: activeConn.id, diff })
                .then(warnings => { impactWarnings = warnings; })
                .catch(err => console.error("Impact check failed", err))
                .finally(() => { loadingImpact = false; renderHeader(); });
        } else {
            loadingImpact = false;
            renderHeader();
        }
    }

    function createDiffCard(type, title, items) {
        const card = document.createElement('div');
        const borderColor = type === 'create' ? (isNeon ? 'border-cyan-400' : 'border-emerald-500/50') : (type === 'drop' ? (isNeon ? 'border-neon-pink' : 'border-red-500/50') : (isNeon ? 'border-amber-400' : (isDawn ? 'border-[#ea9d34]/50' : 'border-amber-500/50')));
        const bgColor = isLight ? 'bg-white shadow-sm' : (isDawn ? 'bg-[#faf4ed]/50' : (isNeon ? 'bg-neon-panel/50 backdrop-blur-sm' : 'bg-white/5'));
        const icon = type === 'create' ? 'add_circle' : (type === 'drop' ? 'remove_circle' : 'edit');
        const iconColor = type === 'create' ? (isNeon ? 'text-cyan-400' : 'text-emerald-500') : (type === 'drop' ? (isNeon ? 'text-neon-pink' : 'text-red-500') : (isNeon ? 'text-amber-400' : (isDawn ? 'text-[#ea9d34]' : 'text-amber-500')));

        card.className = `rounded-lg border-l-4 transition-all duration-300 ${borderColor} ${bgColor} overflow-hidden`;
        card.innerHTML = `
            <div class="px-4 py-3 flex items-center justify-between border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : (isNeon ? 'border-neon-border/20' : 'border-white/5'))}">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-base ${iconColor}">${icon}</span>
                    <span class="font-bold text-sm ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-gray-200'))}">${title}</span>
                </div>
                <span class="text-[10px] font-bold uppercase opacity-50 ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-400'))}">${type}</span>
            </div>
            ${items.length > 0 ? `
                <div class="px-4 py-3 text-[11px] font-mono space-y-1 opacity-80">
                    ${items.map(item => {
            let color = '';
            if (item.startsWith('+')) color = isNeon ? 'text-cyan-400' : 'text-emerald-500';
            else if (item.startsWith('-')) color = isNeon ? 'text-neon-pink' : 'text-red-500';
            else color = isNeon ? 'text-amber-400' : (isDawn ? 'text-[#ea9d34]' : 'text-amber-500');
            return `<div class="truncate ${color}">${item}</div>`;
        }).join('')}
                </div>
            ` : ''}
        `;
        return card;
    }

    return container;
}
