import { invoke } from '@tauri-apps/api/core';
import { toastError, toastSuccess } from '../../utils/Toast.js';
import { ThemeManager } from '../../utils/ThemeManager.js';
import { AskAiModal } from './AskAiModal.js';
import { AiService } from '../../utils/AiService.js';
import { CustomDropdown } from './CustomDropdown.js';

export class AskAiBar {
    static async show(container, onInsert) {
        // Remove existing
        const existing = document.getElementById('ask-ai-bar');
        if (existing) existing.remove();

        const flags = ThemeManager.getThemeFlags();
        const { isLight, isDawn, isOceanic, isEmber, isAurora, theme } = flags;
        const isLightVariant = flags.isLightVariant;

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

        const bar = document.createElement('div');
        bar.id = 'ask-ai-bar';
        bar.className = `absolute top-0 left-0 right-0 z-[100] transform -translate-y-full transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex justify-center p-4 pointer-events-none`;

        const inner = document.createElement('div');
        // Use theme-aware background and border
        const bgClass = isLight ? 'bg-white/90' : (isDawn ? 'bg-[#fffaf3]/95' : (isOceanic ? 'bg-[#3B4252]/90' : (isEmber ? 'bg-[#1d141c]/95' : (isAurora ? 'bg-[#0f1a1d]/95' : 'bg-[#16191e]/90'))));
        const borderClass = isLight ? 'border-gray-200 shadow-xl' : (isDawn ? 'border-[#f2e9e1] shadow-xl' : (isOceanic ? 'border-[#4C566A] shadow-2xl' : (isEmber ? 'border-[#2c1c27] shadow-2xl' : (isAurora ? 'border-[#1b2e33] shadow-2xl' : 'border-white/10 shadow-2xl'))));
        const accentText = isLight ? 'text-rose-500' : (isDawn ? 'text-[#d7827e]' : (isOceanic ? 'text-ocean-frost' : (isEmber ? 'text-amber-500' : (isAurora ? 'text-cyan-400' : 'text-rose-500'))));
        const accentBg = isLight ? 'bg-rose-100' : (isDawn ? 'bg-[#f2e9e1]' : (isOceanic ? 'bg-ocean-frost/10' : (isEmber ? 'bg-amber-500/10' : (isAurora ? 'bg-cyan-400/10' : 'bg-rose-500/10'))));

        inner.className = `w-full max-w-2xl ${bgClass} backdrop-blur-xl border ${borderClass} rounded-2xl flex flex-col pointer-events-auto ring-1 ring-white/5`;

        inner.innerHTML = `
            <div class="px-5 py-4 flex items-center gap-4">
                <div class="flex-shrink-0 w-9 h-9 rounded-xl ${accentBg} ${accentText} flex items-center justify-center shadow-inner">
                    <span class="material-symbols-outlined text-xl">auto_awesome</span>
                </div>
                <div class="flex-1 relative">
                    <input type="text" id="ai-bar-prompt" 
                        class="w-full bg-transparent border-none outline-none text-[15px] ${isLightVariant ? 'text-gray-800 placeholder:text-gray-400' : 'text-gray-100 placeholder:text-gray-600'} py-1.5 focus:ring-0" 
                        placeholder="Describe the query you want to generate..." autocomplete="off">
                </div>
                <div class="flex items-center gap-2">
                    <div class="h-6 w-[1px] ${isLightVariant ? 'bg-gray-200' : 'bg-white/10'} mx-2"></div>
                    <div class="flex flex-col items-end">
                        <div id="ai-bar-model-container" class="min-w-[120px]"></div>
                        <span class="text-[9px] ${isLightVariant ? 'text-gray-400' : 'text-gray-600'} uppercase tracking-widest font-bold mt-1">Model</span>
                    </div>
                </div>
            </div>
            <div id="ai-bar-status" class="hidden px-5 py-2.5 border-t ${isLightVariant ? 'border-gray-100 bg-gray-50/50' : 'border-white/5 bg-black/20'} rounded-b-2xl flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-base animate-spin ${isOceanic ? 'text-ocean-frost' : (isEmber ? 'text-amber-500' : (isAurora ? 'text-cyan-400' : 'text-mysql-teal'))}">progress_activity</span>
                    <span id="ai-bar-status-text" class="text-[11px] font-semibold ${isOceanic ? 'text-ocean-frost' : (isEmber ? 'text-amber-500' : (isAurora ? 'text-cyan-400' : 'text-mysql-teal'))}">Processing...</span>
                </div>
                <div class="text-[9px] ${isLightVariant ? 'text-gray-400' : 'text-gray-600'} font-mono uppercase">Please wait</div>
            </div>
        `;

        bar.appendChild(inner);
        container.appendChild(bar);

        // Initialize Model Dropdown
        let currentModel = savedModel;
        const modelContainer = inner.querySelector('#ai-bar-model-container');

        const getModelItems = () => {
            if (isLocal) return [{ value: savedModel, label: savedModel, icon: 'bolt' }];
            if (isGemini) return [
                { value: 'gemini-2.5-flash', label: 'Gemini Flash', icon: 'auto_awesome' },
                { value: 'gemini-1.5-flash', label: 'Gemini 1.5', icon: 'auto_awesome' }
            ];
            if (isAnthropic) return [
                { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5', icon: 'auto_awesome' },
                { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus', icon: 'auto_awesome' }
            ];
            if (isDeepSeek) return [
                { value: 'deepseek-chat', label: 'DeepSeek Chat', icon: 'auto_awesome' },
                { value: 'deepseek-reasoner', label: 'DS Reasoner', icon: 'auto_awesome' }
            ];
            return [
                { value: 'gpt-4o', label: 'GPT-4o', icon: 'auto_awesome' },
                { value: 'gpt-4o-mini', label: 'GPT-4o Mini', icon: 'auto_awesome' }
            ];
        };

        const modelDropdown = new CustomDropdown({
            items: getModelItems(),
            value: savedModel,
            className: 'ai-bar-model-dropdown',
            searchable: false,
            onSelect: (val) => { currentModel = val; }
        });
        modelContainer.appendChild(modelDropdown.getElement());

        // Slide down animation with a slight bounce
        requestAnimationFrame(() => {
            bar.classList.remove('-translate-y-full');
            bar.classList.add('translate-y-0');
        });

        const input = inner.querySelector('#ai-bar-prompt');
        input.focus();

        const close = () => {
            bar.classList.remove('translate-y-0');
            bar.classList.add('-translate-y-full', 'opacity-0');
            setTimeout(() => bar.remove(), 400);
        };

        input.onkeydown = async (e) => {
            if (e.key === 'Escape') {
                close();
            } else if (e.key === 'Enter') {
                const prompt = input.value.trim();
                const model = currentModel;
                const apiKey = getSavedKey(provider);

                if (!prompt) return;

                if (!isLocal && !apiKey) {
                    toastError(`AI API Key not found in Settings.`);
                    return;
                }

                // UI State
                const statusEl = inner.querySelector('#ai-bar-status');
                const statusText = inner.querySelector('#ai-bar-status-text');
                statusEl.classList.remove('hidden');
                input.disabled = true;
                input.classList.add('opacity-50');

                try {
                    statusText.textContent = "Analyzing database schema...";
                    const context = await AskAiModal.gatherSchemaContext();

                    statusText.textContent = `Asking ${provider.charAt(0).toUpperCase() + provider.slice(1)}...`;
                    const sql = await AiService.generateSql(provider, apiKey, model, prompt, context);

                    onInsert(sql);
                    toastSuccess('SQL Generated!');
                    close();
                } catch (err) {
                    console.error('AI Bar Error:', err);
                    toastError(`Failed: ${err.message}`);
                    statusEl.classList.add('hidden');
                    input.disabled = false;
                    input.classList.remove('opacity-50');
                    input.focus();
                }
            }
        };

        // Close on mousedown outside
        const handleOutsideClick = (e) => {
            if (!inner.contains(e.target) && document.body.contains(bar)) {
                close();
                document.removeEventListener('mousedown', handleOutsideClick);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', handleOutsideClick), 10);
    }
}
