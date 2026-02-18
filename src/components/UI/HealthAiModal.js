import { ThemeManager } from '../../utils/ThemeManager.js';
import { AiService } from '../../utils/AiService.js';
import { toastError } from '../../utils/Toast.js';

export class HealthAiModal {
    static currentModal = null;

    static show(healthReport, recommendations, connection) {
        if (this.currentModal) {
            this.currentModal.remove();
        }

        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';

        const overlay = document.createElement('div');
        overlay.id = 'health-ai-modal';
        overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 opacity-0 transition-opacity duration-200';

        const provider = localStorage.getItem('ai_provider') || 'openai';
        const getApiKey = (p) => {
            if (p === 'gemini') return localStorage.getItem('gemini_api_key') || '';
            if (p === 'anthropic') return localStorage.getItem('anthropic_api_key') || '';
            if (p === 'deepseek') return localStorage.getItem('deepseek_api_key') || '';
            if (p === 'groq') return localStorage.getItem('groq_api_key') || '';
            if (p === 'mistral') return localStorage.getItem('mistral_api_key') || '';
            if (p === 'local') return localStorage.getItem('local_api_key') || '';
            return localStorage.getItem('openai_api_key') || '';
        };

        const modal = document.createElement('div');
        modal.className = `${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : 'bg-[#16191e] border border-white/10')} rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col transform scale-95 transition-transform duration-200`;

        modal.innerHTML = `
            <div class="px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/5 bg-[#13161b]')} rounded-t-xl flex items-center justify-between flex-shrink-0">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg ${isLight ? 'bg-emerald-100 text-emerald-500' : (isDawn ? 'bg-[#f2e9e1] text-[#8da3b8]' : 'bg-emerald-500/10 text-emerald-500')} flex items-center justify-center">
                        <span class="material-symbols-outlined text-lg">auto_awesome</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')} uppercase tracking-wider">AI Health Analysis</h2>
                        <div class="text-[10px] text-gray-500">Powered by ${provider.charAt(0).toUpperCase() + provider.slice(1)}</div>
                    </div>
                </div>
                <button id="close-health-ai-modal" class="w-8 h-8 flex items-center justify-center rounded-lg ${isLight ? 'hover:bg-gray-100 text-gray-500' : (isDawn ? 'hover:bg-[#f2e9e1] text-[#575279]' : 'hover:bg-white/10 text-gray-400')} transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            
            <div class="flex-1 overflow-auto p-6 space-y-4">
                <div id="ai-analysis-content" class="prose prose-sm max-w-none ${isLight ? 'prose-gray' : 'prose-invert'}">
                    <div class="flex flex-col items-center justify-center py-12 text-center">
                        <span class="material-symbols-outlined text-4xl text-emerald-500 animate-spin">progress_activity</span>
                        <p class="mt-4 text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">Analyzing your database health...</p>
                    </div>
                </div>
            </div>

            <div class="px-6 py-4 border-t ${isLight ? 'border-gray-100 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : 'border-white/5 bg-[#13161b]')} rounded-b-xl flex items-center justify-between flex-shrink-0">
                <div class="flex items-center gap-2">
                    <input type="text" id="ai-health-question" placeholder="Ask about your health report..." 
                        class="px-3 py-2 rounded-lg text-xs ${isLight ? 'bg-white border-gray-200 text-gray-800' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} border w-64 outline-none focus:border-emerald-500/50 transition-colors">
                    <button id="ask-ai-btn" class="px-4 py-2 rounded-lg ${isLight ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'} text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-sm">chat</span> Ask
                    </button>
                </div>
                <div class="flex items-center gap-2">
                    <button id="regenerate-analysis" class="px-4 py-2 rounded-lg ${isLight ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-white/5 text-gray-400 hover:bg-white/10'} text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-sm">refresh</span> Regenerate
                    </button>
                    <button id="copy-analysis" class="px-4 py-2 rounded-lg bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-sm">content_copy</span> Copy
                    </button>
                </div>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this.currentModal = overlay;

        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
            modal.classList.remove('scale-95');
        });

        const closeModal = () => {
            overlay.classList.add('opacity-0');
            modal.classList.add('scale-95');
            setTimeout(() => {
                overlay.remove();
                this.currentModal = null;
            }, 200);
        };

        modal.querySelector('#close-health-ai-modal').addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        const runAnalysis = async () => {
            const contentDiv = modal.querySelector('#ai-analysis-content');
            const apiKey = getApiKey(provider);
            const model = localStorage.getItem(`${provider}_model`) || (provider === 'openai' ? 'gpt-4o' : 'gemini-2.5-flash');

            if (!apiKey && provider !== 'local') {
                contentDiv.innerHTML = `
                    <div class="text-center py-8">
                        <span class="material-symbols-outlined text-4xl text-yellow-500">key_off</span>
                        <p class="mt-4 text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">No API key configured for ${provider}</p>
                        <p class="text-xs mt-2 ${isLight ? 'text-gray-500' : 'text-gray-500'}">Please configure your API key in Settings</p>
                    </div>
                `;
                return;
            }

            try {
                const analysis = await AiService.analyzeHealthReport(provider, apiKey, model, {
                    healthReport,
                    recommendations,
                    connection: { dbType: connection?.dbType || localStorage.getItem('activeDbType'), name: connection?.name || 'default' }
                });

                contentDiv.innerHTML = this.renderMarkdown(analysis, isLight);
            } catch (error) {
                contentDiv.innerHTML = `
                    <div class="text-center py-8">
                        <span class="material-symbols-outlined text-4xl text-red-500">error</span>
                        <p class="mt-4 text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">Analysis failed</p>
                        <p class="text-xs mt-2 text-red-500">${error.message}</p>
                    </div>
                `;
                toastError(`AI analysis failed: ${error.message}`);
            }
        };

        modal.querySelector('#regenerate-analysis').addEventListener('click', () => {
            modal.querySelector('#ai-analysis-content').innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 text-center">
                    <span class="material-symbols-outlined text-4xl text-emerald-500 animate-spin">progress_activity</span>
                    <p class="mt-4 text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">Regenerating analysis...</p>
                </div>
            `;
            runAnalysis();
        });

        modal.querySelector('#copy-analysis').addEventListener('click', () => {
            const content = modal.querySelector('#ai-analysis-content').innerText;
            navigator.clipboard.writeText(content).then(() => {
                const btn = modal.querySelector('#copy-analysis');
                const original = btn.innerHTML;
                btn.innerHTML = '<span class="material-symbols-outlined text-sm">check</span> Copied';
                setTimeout(() => btn.innerHTML = original, 2000);
            });
        });

        modal.querySelector('#ask-ai-btn').addEventListener('click', async () => {
            const input = modal.querySelector('#ai-health-question');
            const question = input.value.trim();
            if (!question) return;

            const contentDiv = modal.querySelector('#ai-analysis-content');
            contentDiv.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 text-center">
                    <span class="material-symbols-outlined text-4xl text-emerald-500 animate-spin">progress_activity</span>
                    <p class="mt-4 text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}">Thinking...</p>
                </div>
            `;

            const apiKey = getApiKey(provider);
            const model = localStorage.getItem(`${provider}_model`) || (provider === 'openai' ? 'gpt-4o' : 'gemini-2.5-flash');

            try {
                const answer = await AiService.answerHealthQuestion(provider, apiKey, model, question, {
                    healthReport,
                    recommendations,
                    connection: { dbType: connection?.dbType || localStorage.getItem('activeDbType') }
                });
                contentDiv.innerHTML = this.renderMarkdown(answer, isLight);
                input.value = '';
            } catch (error) {
                toastError(`Failed to get answer: ${error.message}`);
            }
        });

        modal.querySelector('#ai-health-question').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                modal.querySelector('#ask-ai-btn').click();
            }
        });

        runAnalysis();
    }

    static renderMarkdown(text, isLight) {
        let html = text
            .replace(/^## (.+)$/gm, `<h2 class="text-lg font-bold ${isLight ? 'text-gray-800' : 'text-white'} mt-6 mb-3 first:mt-0">$1</h2>`)
            .replace(/^### (.+)$/gm, `<h3 class="text-base font-bold ${isLight ? 'text-gray-700' : 'text-gray-200'} mt-5 mb-2">$1</h3>`)
            .replace(/\*\*(.+?)\*\*/g, `<strong class="${isLight ? 'text-gray-800' : 'text-white'}">$1</strong>`)
            .replace(/^- (.+)$/gm, `<li class="${isLight ? 'text-gray-600' : 'text-gray-300'} ml-4 list-disc">$1</li>`)
            .replace(/^(\d+)\. (.+)$/gm, `<li class="${isLight ? 'text-gray-600' : 'text-gray-300'} ml-4 list-decimal" value="$1">$2</li>`)
            .replace(/```sql\n([\s\S]*?)```/g, `<pre class="bg-black/20 rounded-lg p-3 overflow-x-auto my-3"><code class="text-xs font-mono ${isLight ? 'text-emerald-600' : 'text-emerald-400'}">$1</code></pre>`)
            .replace(/```\n([\s\S]*?)```/g, `<pre class="bg-black/20 rounded-lg p-3 overflow-x-auto my-3"><code class="text-xs font-mono ${isLight ? 'text-gray-700' : 'text-gray-300'}">$1</code></pre>`)
            .replace(/`([^`]+)`/g, `<code class="bg-black/10 px-1.5 py-0.5 rounded text-xs font-mono ${isLight ? 'text-purple-600' : 'text-purple-400'}">$1</code>`)
            .replace(/\n\n/g, '</p><p class="mb-3">')
            .replace(/\n/g, '<br>');

        return `<div class="${isLight ? 'text-gray-600' : 'text-gray-300'} text-sm leading-relaxed"><p class="mb-3">${html}</p></div>`;
    }

    static async explainMetric(metric, dbType) {
        const provider = localStorage.getItem('ai_provider') || 'openai';
        const getApiKey = (p) => {
            if (p === 'gemini') return localStorage.getItem('gemini_api_key') || '';
            if (p === 'anthropic') return localStorage.getItem('anthropic_api_key') || '';
            if (p === 'deepseek') return localStorage.getItem('deepseek_api_key') || '';
            if (p === 'local') return localStorage.getItem('local_api_key') || '';
            return localStorage.getItem('openai_api_key') || '';
        };

        const apiKey = getApiKey(provider);
        const model = localStorage.getItem(`${provider}_model`) || (provider === 'openai' ? 'gpt-4o' : 'gemini-2.5-flash');

        if (!apiKey && provider !== 'local') {
            throw new Error('No API key configured');
        }

        return await AiService.explainMetric(provider, apiKey, model, { metric, dbType });
    }

    static async generateFix(recommendation, healthReport, dbType) {
        const provider = localStorage.getItem('ai_provider') || 'openai';
        const getApiKey = (p) => {
            if (p === 'gemini') return localStorage.getItem('gemini_api_key') || '';
            if (p === 'anthropic') return localStorage.getItem('anthropic_api_key') || '';
            if (p === 'deepseek') return localStorage.getItem('deepseek_api_key') || '';
            if (p === 'local') return localStorage.getItem('local_api_key') || '';
            return localStorage.getItem('openai_api_key') || '';
        };

        const apiKey = getApiKey(provider);
        const model = localStorage.getItem(`${provider}_model`) || (provider === 'openai' ? 'gpt-4o' : 'gemini-2.5-flash');

        if (!apiKey && provider !== 'local') {
            throw new Error('No API key configured');
        }

        return await AiService.generateFixRecommendation(provider, apiKey, model, {
            recommendation,
            healthReport,
            dbType
        });
    }
}
