import { ThemeManager } from '../../utils/ThemeManager.js';

export class AiAssistanceModal {
    static async show(title, content, options = {}) {
        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora' || theme === 'copper';

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center p-4 animate-in fade-in duration-200';

        const modal = document.createElement('div');
        modal.className = `${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/40' : 'bg-[#1a1d23] border-white/10'))} border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200`;

        modal.innerHTML = `
            <!-- Header -->
            <div class="px-6 py-4 border-b ${isLight ? 'border-gray-100 bg-gray-50/50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]/50' : (isOceanic ? 'border-ocean-border/20 bg-ocean-bg/30' : 'border-white/5 bg-white/2'))} flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-mysql-teal/10 flex items-center justify-center text-mysql-teal">
                        <span class="material-symbols-outlined text-[24px]">auto_awesome</span>
                    </div>
                    <div>
                        <h2 class="text-sm font-black uppercase tracking-widest ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')}">${title}</h2>
                        <div class="text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'} font-black uppercase tracking-tighter">AI-Powered Insights</div>
                    </div>
                </div>
                <button id="close-assistance" class="p-2 rounded-xl hover:bg-black/5 transition-colors text-gray-400 hover:text-gray-600">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto p-6 custom-scrollbar text-sm leading-relaxed ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                <div id="assistance-content" class="markdown-body">
                    ${this.formatMarkdown(content)}
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 border-t ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} flex items-center justify-end gap-3">
                ${options.showApply ? `
                    <button id="apply-assistance" class="px-4 py-2 bg-mysql-teal text-black rounded-xl font-bold text-xs hover:brightness-110 active:scale-95 transition-all flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">check_circle</span>
                        Apply Changes
                    </button>
                ` : ''}
                <button id="ok-assistance" class="px-4 py-2 ${isLight ? 'bg-gray-100 text-gray-700' : 'bg-white/5 text-gray-300'} rounded-xl font-bold text-xs hover:bg-white/10 transition-all">
                    Dismiss
                </button>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.appendChild(modal);

        return new Promise((resolve) => {
            const close = () => {
                overlay.classList.add('fade-out');
                modal.classList.add('zoom-out');
                setTimeout(() => overlay.remove(), 200);
                resolve(null);
            };

            modal.querySelector('#close-assistance').onclick = close;
            modal.querySelector('#ok-assistance').onclick = close;
            overlay.onclick = (e) => { if (e.target === overlay) close(); };

            if (options.showApply) {
                modal.querySelector('#apply-assistance').onclick = () => {
                    const sql = this.extractSqlFromMarkdown(content);
                    resolve(sql || content);
                    close();
                };
            }
        });
    }

    static formatMarkdown(text) {
        // Very basic markdown partial formatter for bold and code blocks
        return text
            .replace(/### (.*)/g, '<h3 class="font-black text-mysql-teal mt-4 mb-2 uppercase">$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-white">$1</strong>')
            .replace(/`(.*?)`/g, '<code class="bg-black/20 px-1 rounded font-mono text-cyan-400">$1</code>')
            .replace(/```sql([\s\S]*?)```/g, '<pre class="bg-black/30 p-4 rounded-xl font-mono text-xs my-3 border border-white/5 text-cyan-300 overflow-x-auto">$1</pre>')
            .replace(/```([\s\S]*?)```/g, '<pre class="bg-black/30 p-4 rounded-xl font-mono text-xs my-3 border border-white/5 overflow-x-auto">$1</pre>')
            .replace(/\n/g, '<br>');
    }

    static extractSqlFromMarkdown(text) {
        const match = text.match(/```sql([\s\S]*?)```/i);
        return match ? match[1].trim() : null;
    }
}
