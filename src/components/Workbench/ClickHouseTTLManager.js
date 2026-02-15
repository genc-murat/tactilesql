import { invoke } from '@tauri-apps/api/core';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { toastSuccess, toastError } from '../../utils/Toast.js';

export function ClickHouseTTLManager({ connection, database, table, parentElement }) {
    let ttlExpression = '';
    let previewData = null;
    let auditData = null;
    let loading = true;
    let previewLoading = false;
    let error = null;

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';

    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col space-y-4';

    const formatBytes = (bytes) => {
        if (!bytes && bytes !== 0) return '0 B';
        if (bytes === 0) return '0 B';
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB', 'PB'][i];
    };

    const render = () => {

        if (loading) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-blue-500">
                    <span class="material-symbols-outlined text-4xl animate-spin mb-2">sync</span>
                    <div class="text-xs uppercase tracking-wider font-bold opacity-80">Loading TTL Config...</div>
                </div>
            `;
            return;
        }

        if (error) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-red-500 text-center p-4">
                    <span class="material-symbols-outlined text-4xl mb-2">error</span>
                    <div>${error}</div>
                    <button id="retry-btn" class="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors uppercase text-xs font-bold">Retry</button>
                </div>
            `;
            container.querySelector('#retry-btn').addEventListener('click', fetchData);
            return;
        }

        const cardBg = isLight ? 'bg-gray-50 border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-white/5 border-white/10');
        const textColor = isLight || isDawn ? 'text-gray-800' : 'text-gray-200';
        const labelColor = isLight || isDawn ? 'text-gray-500' : 'text-gray-400';
        const inputBg = isLight ? 'bg-white border-gray-300' : (isDawn ? 'bg-white border-[#e6d0bf]' : 'bg-black/20 border-white/10');

        container.innerHTML = `
            <div class="flex flex-col h-full gap-4 max-w-4xl mx-auto w-full">
                <div class="p-6 rounded-lg border ${cardBg} space-y-6">
                    <div class="flex items-start gap-4">
                        <span class="material-symbols-outlined text-blue-500 text-3xl mt-1">schedule</span>
                        <div class="flex-1">
                            <h3 class="text-lg font-bold ${textColor}">Table TTL Configuration</h3>
                            <p class="text-sm ${labelColor} mt-1">
                                Define the Time-To-Live (TTL) policy for this table to automatically delete old data. 
                                <br>Example: <code class="bg-black/10 dark:bg-white/10 px-1 rounded font-mono text-xs">event_time + INTERVAL 30 DAY</code>
                            </p>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-bold uppercase tracking-wider ${labelColor}">TTL Expression</label>
                        <textarea id="ttl-input" 
                            class="w-full h-32 p-4 rounded font-mono text-sm ${inputBg} ${textColor} focus:outline-none focus:border-blue-500 transition-colors resize-none"
                            placeholder="e.g. event_time + INTERVAL 1 MONTH"
                            spellcheck="false"
                        >${ttlExpression || ''}</textarea>
                        
                        <div class="flex justify-between items-center">
                             <div class="flex gap-2">
                                <button id="preview-btn" class="px-3 py-1.5 bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-gray-300 rounded font-bold text-xs hover:bg-gray-300 dark:hover:bg-white/20 transition-colors flex items-center gap-1">
                                    <span class="material-symbols-outlined text-sm">visibility</span> Preview Impact
                                </button>
                             </div>
                            
                            <div class="flex gap-2">
                                <button id="apply-btn" class="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded font-bold text-sm transition-colors flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm">save</span> Apply Changes
                                </button>
                            </div>
                        </div>

                        ${previewData ? `
                            <div class="mt-4 p-3 rounded border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20 text-xs">
                                <div class="font-bold text-blue-800 dark:text-blue-300 mb-1 flex items-center gap-1">
                                    <span class="material-symbols-outlined text-sm">info</span> Impact Analysis (Expired Rows)
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <div class="opacity-70">Rows to Delete</div>
                                        <div class="font-mono font-bold text-lg">${previewData.affected_rows.toLocaleString()}</div>
                                    </div>
                                    <div>
                                        <div class="opacity-70">Data Size</div>
                                        <div class="font-mono font-bold text-lg">${formatBytes(previewData.affected_bytes)}</div>
                                    </div>
                                </div>
                            </div>
                        ` : ''}

                         ${auditData && !auditData.is_efficient && ttlExpression ? `
                            <div class="mt-2 p-3 rounded border border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-900/20 text-xs">
                                <div class="font-bold text-orange-800 dark:text-orange-300 mb-1 flex items-center gap-1">
                                    <span class="material-symbols-outlined text-sm">warning</span> Efficiency Warning
                                </div>
                                <div>
                                    The TTL expression does not appear to use the table's <strong>Sorting Key</strong> (${auditData.sorting_key}). 
                                    Background merges might be slow as they will require full data scans.
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>

                <div class="p-4 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900/30 dark:bg-yellow-900/10 flex gap-3">
                    <span class="material-symbols-outlined text-yellow-600 dark:text-yellow-400">warning</span>
                    <div class="text-xs ${isLight ? 'text-yellow-800' : 'text-yellow-200'}">
                        <strong>Warning:</strong> Modifying the TTL policy triggers an <code>ALTER TABLE</code> operation. 
                        Changing the TTL on large tables might trigger background merges to remove old data immediately.
                    </div>
                </div>
            </div>
        `;

        const textarea = container.querySelector('#ttl-input');
        const applyBtn = container.querySelector('#apply-btn');
        const previewBtn = container.querySelector('#preview-btn');

        previewBtn.addEventListener('click', async () => {
            const expr = textarea.value.trim();
            if (!expr) {
                toastError('Please enter a TTL expression first.');
                return;
            }

            previewBtn.disabled = true;
            previewBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">sync</span> Calculating...`;

            try {
                // Parallel fetch: Preview + Audit
                const [preview, audit] = await Promise.all([
                    invoke('get_clickhouse_ttl_preview', { config: connection, database, table, ttlExpression: expr }),
                    invoke('get_clickhouse_ttl_audit', { config: connection, database, table, ttlExpression: expr })
                ]);

                previewData = preview;
                auditData = audit;

                // We re-render to show the results
                // Temporarily store the current input so it isn't lost on re-render if state wasn't synced
                ttlExpression = expr;
                render();
            } catch (e) {
                console.error(e);
                toastError('Preview failed: ' + e);
            } finally {
                // If we didn't re-render (error case), reset button
                if (container.querySelector('#preview-btn')) {
                    container.querySelector('#preview-btn').disabled = false;
                    container.querySelector('#preview-btn').innerHTML = `<span class="material-symbols-outlined text-sm">visibility</span> Preview Impact`;
                }
            }
        });

        applyBtn.addEventListener('click', async () => {
            const newTTL = textarea.value.trim();

            if (newTTL === ttlExpression) {
                toastSuccess('No changes to apply.');
                return;
            }

            const confirmMsg = newTTL
                ? `Are you sure you want to set the TTL to:\n${newTTL}?`
                : 'Are you sure you want to REMOVE the TTL policy?';

            if (!confirm(confirmMsg)) return;

            applyBtn.disabled = true;
            applyBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">sync</span> Applying...`;

            try {
                await invoke('modify_clickhouse_ttl', {
                    config: connection,
                    database,
                    table,
                    ttlExpression: newTTL
                });
                toastSuccess('TTL Policy updated successfully.');
                ttlExpression = newTTL;
            } catch (e) {
                console.error(e);
                toastError('Failed to update TTL: ' + e);
            } finally {
                applyBtn.disabled = false;
                applyBtn.innerHTML = `<span class="material-symbols-outlined text-sm">save</span> Apply Changes`;
            }
        });
    };

    const fetchData = async () => {
        loading = true;
        error = null;
        render();
        try {
            const status = await invoke('get_clickhouse_ttl_status', { config: connection, database, table });
            ttlExpression = status.table_ttl_expression || '';
        } catch (e) {
            console.error(e);
            error = e;
        } finally {
            loading = false;
            render();
        }
    };

    parentElement.appendChild(container);
    fetchData();

    return {
        refresh: fetchData,
        destroy: () => container.remove()
    };
}
