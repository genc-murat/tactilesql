import { invoke } from '@tauri-apps/api/core';
import { toastError, toastSuccess } from '../../utils/Toast.js';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { AiService } from '../../utils/AiService.js';
import { CustomDropdown } from './CustomDropdown.js';

export class AskAiModal {
    static async show(onInsert) {
        // Remove existing
        const existing = document.getElementById('ask-ai-modal');
        if (existing) existing.remove();

        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

        const overlay = document.createElement('div');
        overlay.id = 'ask-ai-modal';
        overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 opacity-0 transition-opacity duration-200';

        // Load saved settings
        const provider = localStorage.getItem('ai_provider') || 'openai';
        const isGemini = provider === 'gemini';
        const isAnthropic = provider === 'anthropic';
        const isDeepSeek = provider === 'deepseek';
        const isLocal = provider === 'local';

        const getSavedKey = (p) => {
            if (p === 'gemini') return localStorage.getItem('gemini_api_key') || '';
            if (p === 'anthropic') return localStorage.getItem('anthropic_api_key') || '';
            if (p === 'deepseek') return localStorage.getItem('deepseek_api_key') || '';
            if (p === 'local') return localStorage.getItem('local_api_key') || '';
            return localStorage.getItem('openai_api_key') || '';
        };
        const getSavedModel = (p) => {
            if (p === 'gemini') return localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
            if (p === 'anthropic') return localStorage.getItem('anthropic_model') || 'claude-3-5-sonnet-20241022';
            if (p === 'deepseek') return localStorage.getItem('deepseek_model') || 'deepseek-chat';
            if (p === 'local') return localStorage.getItem('local_model') || 'llama3';
            return localStorage.getItem('openai_model') || 'gpt-4o';
        };

        const savedKey = getSavedKey(provider);
        const savedModel = getSavedModel(provider);

        const modal = document.createElement('div');
        modal.className = `${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#16191e] border border-white/10'))} rounded-xl shadow-2xl w-full max-w-lg transform scale-95 transition-transform duration-200 flex flex-col`;

        modal.innerHTML = `
            <div class="px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/5 bg-[#13161b]'))} rounded-t-xl flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg ${isLight ? 'bg-rose-100 text-rose-500' : (isDawn ? 'bg-[#f2e9e1] text-[#d7827e]' : 'bg-rose-500/10 text-rose-500')} flex items-center justify-center">
                        <span class="material-symbols-outlined text-lg">auto_awesome</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')} uppercase tracking-wider">Generate SQL With AI</h2>
                        <div class="text-[10px] text-gray-500 font-mono">Powered by ${isGemini ? 'Google Gemini' : (isAnthropic ? 'Anthropic' : (isDeepSeek ? 'DeepSeek' : (isLocal ? 'Local AI' : 'OpenAI')))}</div>
                    </div>
                </div>
                <button id="close-modal" class="w-8 h-8 flex items-center justify-center rounded-lg ${isLight ? 'hover:bg-gray-100 text-gray-500' : (isDawn ? 'hover:bg-[#f2e9e1] text-[#575279]' : 'hover:bg-white/10 text-gray-400')} transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            
            <div class="p-6 space-y-4">
                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Model</label>
                    <div id="ai-model-container"></div>
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-400'}">Prompt</label>
                    <textarea id="ai-prompt" class="w-full h-32 ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-400' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279] placeholder:text-[#9893a5]' : 'bg-black/20 border-white/10 text-gray-300 placeholder:text-gray-600')} rounded px-3 py-2 text-xs font-mono outline-none focus:border-mysql-teal transition-colors resize-none leading-relaxed" placeholder="e.g. Show me the top 5 customers by total order amount in 2023..."></textarea>
                </div>

                <div id="ai-status" class="hidden text-xs text-mysql-teal flex items-center gap-2 p-2 bg-mysql-teal/10 rounded border border-mysql-teal/20">
                    <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    <span id="ai-status-text">Generating SQL...</span>
                </div>
            </div>

            <div class="px-6 py-4 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border/30 bg-ocean-panel' : 'border-white/5 bg-[#13161b]'))} rounded-b-xl flex justify-end gap-3">
                <button id="cancel-btn" class="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-500 hover:bg-gray-200' : 'text-gray-400 hover:bg-white/10'} transition-colors">Cancel</button>
                <button id="generate-btn" class="px-6 py-2 rounded-lg bg-mysql-teal text-black text-xs font-bold uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-2 shadow-[0_0_10px_rgba(0,200,255,0.2)]">
                    <span class="material-symbols-outlined text-sm">auto_awesome</span> Generate
                </button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Initialize Model Selector
        let currentModel = savedModel;
        const modelContainer = modal.querySelector('#ai-model-container');

        if (isLocal) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = `w-full ${isLight ? 'bg-gray-50 border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded px-3 py-2 text-xs font-mono outline-none focus:border-mysql-teal transition-colors`;
            input.placeholder = 'e.g. llama3';
            input.value = savedModel;
            input.oninput = (e) => { currentModel = e.target.value.trim(); };
            modelContainer.appendChild(input);
        } else {
            const getModelItems = () => {
                if (isGemini) return [
                    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', icon: 'auto_awesome' },
                    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (Exp)', icon: 'auto_awesome' },
                    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Stable)', icon: 'auto_awesome' },
                    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Powerful)', icon: 'auto_awesome' }
                ];
                if (isAnthropic) return [
                    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', icon: 'auto_awesome' },
                    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus', icon: 'auto_awesome' },
                    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', icon: 'auto_awesome' }
                ];
                if (isDeepSeek) return [
                    { value: 'deepseek-chat', label: 'DeepSeek Chat', icon: 'auto_awesome' },
                    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner', icon: 'auto_awesome' }
                ];
                return [
                    { value: 'gpt-4o', label: 'GPT-4o (Best)', icon: 'auto_awesome' },
                    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)', icon: 'auto_awesome' },
                    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', icon: 'auto_awesome' }
                ];
            };

            const modelDropdown = new CustomDropdown({
                items: getModelItems(),
                value: savedModel,
                onSelect: (val) => { currentModel = val; }
            });
            modelContainer.appendChild(modelDropdown.getElement());
        }

        // Animation
        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
            modal.classList.remove('scale-95');
        });

        // Event Handlers
        const close = () => {
            overlay.classList.add('opacity-0');
            modal.classList.add('scale-95');
            setTimeout(() => overlay.remove(), 200);
        };

        overlay.querySelector('#close-modal').onclick = close;
        overlay.querySelector('#cancel-btn').onclick = close;

        // Close on click outside
        overlay.onclick = (e) => {
            if (e.target === overlay) close();
        };

        // Focus prompt
        setTimeout(() => overlay.querySelector('#ai-prompt').focus(), 100);

        const generateBtn = overlay.querySelector('#generate-btn');
        generateBtn.onclick = async () => {
            const apiKey = getSavedKey(provider);
            const model = currentModel;
            const prompt = overlay.querySelector('#ai-prompt').value.trim();

            if (!isLocal && !apiKey) {
                toastError(`AI API Key not found. Please configure it in Settings.`);
                return;
            }
            if (!prompt) {
                toastError('Please enter a prompt');
                return;
            }

            // Save preferences
            if (isGemini) {
                localStorage.setItem('gemini_model', model);
            } else if (isAnthropic) {
                localStorage.setItem('anthropic_model', model);
            } else if (isDeepSeek) {
                localStorage.setItem('deepseek_model', model);
            } else if (isLocal) {
                localStorage.setItem('local_model', model);
            } else {
                localStorage.setItem('openai_model', model);
            }

            // UI Loading State
            const statusEl = overlay.querySelector('#ai-status');
            const statusText = overlay.querySelector('#ai-status-text');
            statusEl.classList.remove('hidden');
            generateBtn.disabled = true;
            generateBtn.classList.add('opacity-50', 'cursor-not-allowed');

            try {
                // 1. Gather Context
                statusText.textContent = "Analyzing database schema...";
                const context = await AskAiModal.gatherSchemaContext();

                // 2. Call AI Provider
                statusText.textContent = `Asking ${provider.charAt(0).toUpperCase() + provider.slice(1)}...`;
                const sql = await AiService.generateSql(provider, apiKey, model, prompt, context);

                // 3. Done
                close();
                onInsert(sql);
                toastSuccess('SQL Generated successfully!');

            } catch (error) {
                console.error('AI Generation Error:', error);
                toastError(`Failed: ${error.message}`);
                statusEl.classList.add('hidden');
                generateBtn.disabled = false;
                generateBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        };
    }

    static async gatherSchemaContext() {
        const activeConfig = JSON.parse(localStorage.getItem('activeConnection') || '{}');
        let database = activeConfig.database;
        const dbType = activeConfig.dbType || 'mysql';

        // 1. Try to resolve via SQL if config is empty
        if (!database || database === 'null' || database === '') {
            try {
                // Try to resolve dynamic database name from server session
                const query = dbType === 'postgresql' ? 'SELECT current_database()' : 'SELECT DATABASE()';
                const results = await invoke('execute_query', { query });

                // execute_query returns an array of results, each having a 'rows' array
                if (results && results[0] && results[0].rows && results[0].rows.length > 0) {
                    database = results[0].rows[0][0];
                }
            } catch (err) {
                console.warn("SQL database resolution failed:", err);
            }
        }

        // 2. Final fallback: if still no database, fetch all databases and pick the first user database
        if (!database || database === 'null' || database === '') {
            try {
                const dbs = await invoke('get_databases');
                if (dbs && dbs.length > 0) {
                    // Filter system databases to find practical user databases
                    const userDbs = dbs.filter(db => !['information_schema', 'mysql', 'performance_schema', 'sys', 'postgres', 'null', ''].includes(String(db).toLowerCase()));
                    database = userDbs.length > 0 ? userDbs[0] : (dbs[0] !== 'null' ? dbs[0] : null);
                    if (database) console.info(`Auto-selected database for AI context: ${database}`);
                }
            } catch (err) {
                console.warn("Database list resolution fallback failed:", err);
            }
        }

        if (!database || database === 'null' || database === '') {
            throw new Error("No active database selected. Please select a database from the header dropdown or re-connect.");
        }

        const tables = await invoke('get_tables', { database });

        // Limit context - prioritizing first 30 tables
        const relevantTables = tables.slice(0, 30);

        let schemaSummary = [];
        const batchSize = 5;

        for (let i = 0; i < relevantTables.length; i += batchSize) {
            const batch = relevantTables.slice(i, i + batchSize);
            const promises = batch.map(async (table) => {
                try {
                    // 1. Get Columns
                    const columns = await invoke('get_table_schema', { database, table });
                    const colNames = columns.map(c => c.name).join(', ');

                    // 2. Get Sample Data (Top 3 rows)
                    let samples = "No sample data available";
                    try {
                        const sampleQuery = `SELECT * FROM ${table} LIMIT 3`;
                        const sampleResults = await invoke('execute_query', { query: sampleQuery });
                        if (sampleResults && sampleResults[0] && sampleResults[0].rows && sampleResults[0].rows.length > 0) {
                            const rows = sampleResults[0].rows.map(row => row.join(' | '));
                            samples = rows.join('\n    ');
                        }
                    } catch (se) {
                        console.warn(`Failed to fetch samples for ${table}:`, se);
                    }

                    return `- Table: ${table}\n  Columns: ${colNames}\n  Sample Data:\n    ${samples}`;
                } catch (e) {
                    return `- Table: ${table} (Error fetching schema)`;
                }
            });
            const results = await Promise.all(promises);
            schemaSummary.push(...results);
        }

        return `
Database Type: ${dbType}
Database Name: ${database}
Schema Summary (STRICTLY USE THESE TABLES AND COLUMNS):
${schemaSummary.join('\n\n')}
        `.trim();
    }

    static cleanSQL(sql) {
        return AiService.cleanSQL(sql);
    }
}
