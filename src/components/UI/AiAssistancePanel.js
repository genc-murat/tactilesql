import { ThemeManager } from '../../utils/ThemeManager.js';

export class AiAssistancePanel {
    static async show(title, content, options = {}) {
        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

        // Remove existing backdrop/panel if any
        this.hide();

        const backdrop = document.createElement('div');
        backdrop.id = 'ai-panel-backdrop';
        backdrop.className = 'fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[9990] animate-in fade-in duration-300';

        const panel = document.createElement('div');
        panel.id = 'ai-assistance-panel';
        panel.className = `fixed right-0 top-0 bottom-0 w-[450px] z-[9991] flex flex-col shadow-2xl border-l animate-slide-in-right ${isLight ? 'bg-white/95 border-gray-200' :
            (isDawn ? 'bg-[#faf4ed]/95 border-[#f2e9e1]' :
                (isOceanic ? 'bg-ocean-panel/95 border-ocean-border' : 'bg-[#1a1d23]/95 border-white/10'))
            } backdrop-blur-xl`;

        panel.innerHTML = `
            <!-- Header -->
            <div class="px-6 py-5 border-b ${isLight ? 'border-gray-100' : 'border-white/5'} flex items-center justify-between relative overflow-hidden group">
                <div class="absolute inset-0 bg-gradient-to-r from-mysql-teal/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div class="flex items-center gap-4 relative z-10">
                    <div class="w-10 h-10 rounded-2xl bg-mysql-teal/10 flex items-center justify-center text-mysql-teal ai-panel-glow border border-mysql-teal/20">
                        <span class="material-symbols-outlined text-[24px]">auto_awesome</span>
                    </div>
                    <div>
                        <h2 class="text-xs font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : 'text-white')}">${title}</h2>
                        <div class="text-[9px] ${isLight ? 'text-gray-400' : 'text-gray-500'} font-black uppercase tracking-tighter mt-0.5">AI-Powered Assistant</div>
                    </div>
                </div>
                <button id="close-panel" class="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-all text-gray-400 hover:text-gray-600 relative z-10 hover:rotate-90 duration-300">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>

            <!-- Content Area -->
            <div class="flex-1 overflow-y-auto custom-scrollbar px-6 py-8">
                <div id="ai-panel-content" class="ai-markdown ${isLight ? 'text-gray-700' : (isDawn ? 'text-[#575279]' : 'text-gray-300')}">
                    ${this.formatMarkdown(content)}
                </div>
            </div>

            <!-- Global Actions -->
            <div class="px-6 py-4 border-t ${isLight ? 'border-gray-100 bg-gray-50/50' : 'border-white/5 bg-white/2'} flex items-center justify-end gap-3">
                <button id="ok-panel" class="px-5 py-2 ${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/5 text-gray-300 hover:bg-white/10'} rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all">
                    Dismiss
                </button>
            </div>
        `;

        document.body.appendChild(backdrop);
        document.body.appendChild(panel);

        return new Promise((resolve) => {
            const hide = () => {
                panel.classList.replace('animate-slide-in-right', 'animate-slide-out-right');
                backdrop.classList.add('fade-out');
                setTimeout(() => {
                    panel.remove();
                    backdrop.remove();
                }, 300);
                resolve(null);
            };

            panel.querySelector('#close-panel').onclick = hide;
            panel.querySelector('#ok-panel').onclick = hide;
            backdrop.onclick = hide;

            // Bind Copy/Apply buttons inside the content
            panel.querySelectorAll('.ai-code-action').forEach(btn => {
                btn.onclick = (e) => {
                    const action = btn.dataset.action;
                    const code = btn.dataset.code;

                    if (action === 'copy') {
                        navigator.clipboard.writeText(code).then(() => {
                            const original = btn.innerHTML;
                            btn.innerHTML = '<span class="material-symbols-outlined text-sm text-green-400">check</span>';
                            setTimeout(() => btn.innerHTML = original, 2000);
                        });
                    } else if (action === 'apply') {
                        resolve(code);
                        hide();
                    }
                };
            });
        });
    }

    static hide() {
        const existingPanel = document.getElementById('ai-assistance-panel');
        const existingBackdrop = document.getElementById('ai-panel-backdrop');
        if (existingPanel) existingPanel.remove();
        if (existingBackdrop) existingBackdrop.remove();
    }

    static formatMarkdown(text) {
        let html = text;

        // Headers
        html = html.replace(/### (.*)/g, (match, p1) =>
            `<h3 class="animate-stagger-fade-in" style="animation-delay: 100ms">${p1}</h3>`
        );

        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-mysql-teal">$1</strong>');

        // Lists (Bullets and Numbered)
        html = html.replace(/^\s*([-*]|\d+\.) (.*)/gm, (match, p1, p2) =>
            `<li class="animate-stagger-fade-in" style="animation-delay: 200ms">${p2}</li>`
        );
        html = html.replace(/(<li>.*<\/li>)/gms, '<ul>$1</ul>');

        // Inline Code
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');

        // SQL Code Blocks with interactive buttons
        html = html.replace(/```sql([\s\S]*?)```/g, (match, code) => {
            const cleanCode = code.trim();
            const escapedCode = cleanCode.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

            return `
                <div class="relative group my-4 animate-stagger-fade-in" style="animation-delay: 300ms">
                    <div class="absolute -inset-0.5 bg-gradient-to-r from-mysql-teal/20 to-cyan-500/20 rounded-xl blur opacity-30 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
                    <div class="relative bg-[#0d0f13] rounded-xl border border-white/10 overflow-hidden">
                        <div class="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
                            <span class="text-[9px] font-black uppercase tracking-widest text-mysql-teal/50">SQL Output</span>
                            <div class="flex items-center gap-1">
                                <button class="ai-code-action p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-all" data-action="copy" data-code="${escapedCode}" title="Copy Code">
                                    <span class="material-symbols-outlined text-[14px]">content_copy</span>
                                </button>
                                <button class="ai-code-action p-1.5 hover:bg-mysql-teal/20 rounded-lg text-mysql-teal transition-all" data-action="apply" data-code="${escapedCode}" title="Apply to Editor">
                                    <span class="material-symbols-outlined text-[14px]">check_circle</span>
                                </button>
                            </div>
                        </div>
                        <pre class="p-4 font-mono text-[11px] leading-relaxed text-cyan-300 overflow-x-auto custom-scrollbar">${cleanCode}</pre>
                    </div>
                </div>
            `;
        });

        // Generic Code Blocks
        html = html.replace(/```([\s\S]*?)```/g, (match, code) => `
            <pre class="bg-black/30 p-4 rounded-xl font-mono text-[11px] my-4 border border-white/5 overflow-x-auto custom-scrollbar animate-stagger-fade-in" style="animation-delay: 400ms">${code.trim()}</pre>
        `);

        // Paragraphs
        const segments = html.split('\n\n');
        return segments.map((seg, i) => {
            const trimmed = seg.trim();
            if (!trimmed) return '';
            if (trimmed.startsWith('<h3') || trimmed.startsWith('<ul') || trimmed.startsWith('<div') || trimmed.startsWith('<pre')) return trimmed;
            return `<p class="animate-stagger-fade-in" style="animation-delay: ${150 + (i * 50)}ms">${trimmed}</p>`;
        }).join('');
    }
}
