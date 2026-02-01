import { ThemeManager } from '../../utils/ThemeManager.js';

export class Dialog {
    static init() {
        if (document.getElementById('tactile-dialog-overlay')) return;

        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        const overlay = document.createElement('div');
        overlay.id = 'tactile-dialog-overlay';
        overlay.className = "fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] hidden flex items-center justify-center opacity-0 transition-opacity duration-200";

        overlay.innerHTML = `
            <div id="tactile-dialog" class="${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#16191e] border border-white/10'))} rounded-2xl w-[400px] shadow-2xl scale-95 transition-transform duration-200 overflow-hidden relative">
                <div class="absolute top-0 inset-x-0 h-1 bg-gradient-to-r ${isOceanic ? 'from-ocean-frost to-ocean-mint' : (isDawn ? 'from-[#ea9d34] to-[#d7827e]' : 'from-neon-cyan to-purple-500')}"></div>
                <div class="p-6 pt-8 text-center space-y-4">
                    <div id="dialog-icon-container" class="mx-auto size-12 rounded-full ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : 'bg-white/5')} flex items-center justify-center mb-4">
                        <span id="dialog-icon" class="material-symbols-outlined text-2xl ${(isLight || isDawn) ? 'text-gray-400' : 'text-white'}">info</span>
                    </div>
                    <h3 id="dialog-title" class="text-sm font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-white'))}"></h3>
                    <p id="dialog-message" class="text-[11px] ${(isLight || isDawn) ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400')} font-mono leading-relaxed whitespace-pre-wrap"></p>
                </div>
                <div id="dialog-actions" class="p-4 ${isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : 'bg-white/5 border-white/5')} flex gap-3 justify-center border-t">
                    <!-- Buttons injected here -->
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        this.overlay = overlay;
        this.dialog = overlay.querySelector('#tactile-dialog');
        this.title = overlay.querySelector('#dialog-title');
        this.message = overlay.querySelector('#dialog-message');
        this.actions = overlay.querySelector('#dialog-actions');
        this.icon = overlay.querySelector('#dialog-icon');
        this.iconContainer = overlay.querySelector('#dialog-icon-container');
    }

    static show({ title, message, type = 'info', onConfirm = null }) {
        this.init();

        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        // Update main container theme
        this.dialog.className = `${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/50' : 'bg-[#16191e] border border-white/10'))} rounded-2xl w-[400px] shadow-2xl scale-95 transition-transform duration-200 overflow-hidden relative`;
        this.title.className = `text-sm font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : 'text-white'))}`;
        this.message.className = `text-[11px] ${(isLight || isDawn) ? 'text-gray-500' : (isOceanic ? 'text-ocean-text/70' : 'text-gray-400')} font-mono leading-relaxed whitespace-pre-wrap`;
        this.actions.className = `p-4 ${isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : 'bg-white/5 border-white/5')} flex gap-3 justify-center border-t`;

        // Set title and message
        this.title.textContent = title;
        // If message contains HTML tags, use it as-is, otherwise convert \n to <br>
        if (message.includes('<')) {
            this.message.innerHTML = message;
        } else {
            // Escape HTML and convert both literal \n and actual newlines to <br>
            const escaped = message
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;')
                .replace(/\\n/g, '<br>')  // literal \n in string
                .replace(/\n/g, '<br>');   // actual newline
            this.message.innerHTML = escaped;
        }

        // Reset icon styles
        this.iconContainer.className = `mx-auto size-12 rounded-full flex items-center justify-center mb-4 border ${isLight ? 'border-gray-200' : 'border-white/10'}`;
        this.icon.className = "material-symbols-outlined text-2xl";

        switch (type) {
            case 'error':
                this.iconContainer.classList.add('bg-red-500/10', 'text-red-500');
                this.icon.textContent = 'error';
                break;
            case 'success':
                this.iconContainer.classList.add('bg-emerald-500/10', 'text-emerald-400');
                this.icon.textContent = 'check_circle';
                break;
            case 'confirm':
                this.iconContainer.classList.add('bg-amber-500/10', 'text-amber-400');
                this.icon.textContent = 'help';
                break;
            default:
                this.iconContainer.classList.add('bg-cyan-500/10', 'text-neon-cyan');
                this.icon.textContent = 'info';
        }

        // Render Buttons
        this.actions.innerHTML = '';

        if (type === 'confirm') {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:bg-white/10 transition-colors";
            cancelBtn.textContent = "Cancel";
            cancelBtn.onclick = () => this.close(false);

            const confirmBtn = document.createElement('button');
            confirmBtn.className = "px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[10px] font-bold uppercase tracking-wider text-red-400 hover:bg-red-500/20 transition-colors";
            confirmBtn.textContent = "Confirm";
            confirmBtn.onclick = () => {
                if (onConfirm) onConfirm();
                this.close(true);
            };

            this.actions.appendChild(cancelBtn);
            this.actions.appendChild(confirmBtn);
        } else {
            const okBtn = document.createElement('button');
            okBtn.className = "w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-white/10 transition-colors";
            okBtn.textContent = "Close";
            okBtn.onclick = () => this.close();
            this.actions.appendChild(okBtn);
        }

        // Show Animation
        this.overlay.classList.remove('hidden');
        // Force reflow
        void this.overlay.offsetWidth;
        this.overlay.classList.remove('opacity-0');
        this.dialog.classList.remove('scale-95');
    }

    static close(result) {
        if (!this.overlay) return;

        this.overlay.classList.add('opacity-0');
        this.dialog.classList.add('scale-95');

        setTimeout(() => {
            this.overlay.classList.add('hidden');
        }, 200);

        return result;
    }

    static alert(message, title = 'Alert') {
        const type = title.toLowerCase().includes('fail') || title.toLowerCase().includes('error') ? 'error' : 'info';
        // Check for 'success' or 'saved'
        const isSuccess = title.toLowerCase().includes('success') || message.toLowerCase().includes('saved');

        // If message doesn't contain HTML, convert \n to <br> before showing
        let processedMessage = message;
        if (!message.includes('<')) {
            // Replace both literal \n strings and actual newline characters
            processedMessage = String(message)
                .replace(/\\n/g, '<br>')  // literal \n in the string
                .replace(/\n/g, '<br>');   // actual newline character
        }

        this.show({
            title,
            message: processedMessage,
            type: isSuccess ? 'success' : type
        });
    }

    static async confirm(message, title = 'Confirm Action') {
        return new Promise((resolve) => {
            this.show({
                title,
                message,
                type: 'confirm',
                onConfirm: () => resolve(true)
            });
            const cancelHandler = () => {
                resolve(false);
                // cleanup handled by close
            };
            // The first button is Cancel in confirm mode
            const cancelBtn = this.actions.querySelector('button');
            if (cancelBtn) cancelBtn.addEventListener('click', cancelHandler);
        });
    }

    static async prompt(message, title = 'Input Required', defaultValue = '') {
        return new Promise((resolve) => {
            // Initialize functionality first
            this.init();

            const theme = ThemeManager.getCurrentTheme();
            const isLight = theme === 'light';
            const isDawn = theme === 'dawn';
            const isOceanic = theme === 'oceanic';

            this.title.textContent = title;
            this.message.textContent = message;

            // Custom Content for Input
            const inputContainer = document.createElement('div');
            inputContainer.className = "mt-3";
            inputContainer.innerHTML = `
                <input type="text" id="dialog-prompt-input" class="w-full ${isLight ? 'bg-white border-gray-200 text-gray-800 focus:border-mysql-teal' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text focus:border-ocean-frost' : 'bg-[#0b0d11] border border-white/10 text-gray-300 focus:border-mysql-teal/50'))} rounded p-2 text-xs outline-none" value="${defaultValue}" />
             `;

            // Temporarily replace message content or append
            // Let's clear message and re-append text + input
            this.message.innerHTML = '';
            this.message.textContent = message;
            this.message.appendChild(inputContainer);

            // Reset Icon
            this.iconContainer.className = "mx-auto size-12 rounded-full flex items-center justify-center mb-4 border border-white/10 bg-cyan-500/10 text-neon-cyan";
            this.icon.textContent = 'edit';

            // Buttons
            this.actions.innerHTML = '';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:bg-white/10 transition-colors";
            cancelBtn.textContent = "Cancel";

            const okBtn = document.createElement('button');
            okBtn.className = "px-4 py-2 rounded-lg bg-mysql-teal text-black text-[10px] font-bold uppercase tracking-wider hover:brightness-110 transition-colors";
            okBtn.textContent = "OK";

            const cleanup = () => {
                // Restore message purely for safety if needed later, but init() handles reset mostly
            };

            cancelBtn.onclick = () => {
                this.close();
                resolve(null);
            };

            okBtn.onclick = () => {
                const val = this.message.querySelector('input').value;
                this.close();
                resolve(val);
            };

            this.actions.appendChild(cancelBtn);
            this.actions.appendChild(okBtn);

            // Animation
            this.overlay.classList.remove('hidden');
            void this.overlay.offsetWidth;
            this.overlay.classList.remove('opacity-0');
            this.dialog.classList.remove('scale-95');

            // Focus
            setTimeout(() => {
                const input = this.message.querySelector('input');
                if (input) input.focus();
            }, 50);
        });
    }

    static async confirmCode(codeHtml, title = 'Confirm Action') {
        return new Promise((resolve) => {
            this.show({
                title,
                message: 'Please review the proposed changes below:',
                type: 'confirm',
                onConfirm: () => resolve(true)
            });

            // Make dialog wider for code
            this.dialog.style.width = '600px';

            const codeContainer = document.createElement('div');
            codeContainer.className = "mt-4 p-4 bg-black/30 rounded-lg border border-white/5 font-mono text-[11px] leading-relaxed text-blue-300 overflow-x-auto max-h-[300px] custom-scrollbar whitespace-pre text-left shadow-inner";
            codeContainer.style.tabSize = '4';
            codeContainer.innerHTML = codeHtml;

            this.message.appendChild(codeContainer);

            const cancelHandler = () => {
                this.dialog.style.width = '400px'; // Reset width
                resolve(false);
            };

            // Override cancel for cleanup
            const cancelBtn = this.actions.querySelector('button');
            if (cancelBtn) cancelBtn.onclick = () => {
                this.close(false);
                this.dialog.style.width = '400px'; // Reset width
                resolve(false);
            };

            // Override confirm for cleanup
            const confirmBtn = this.actions.lastElementChild;
            if (confirmBtn) confirmBtn.onclick = () => {
                this.close(true);
                this.dialog.style.width = '400px'; // Reset width
                resolve(true);
            };
        });
    }

    static showSQL(sql, title = 'Generated SQL') {
        this.show({
            title,
            message: '',
            type: 'info'
        });

        // Make dialog wider
        this.dialog.style.width = '600px';
        this.icon.textContent = 'code';
        this.iconContainer.className = "mx-auto size-12 rounded-full flex items-center justify-center mb-4 border border-white/10 bg-purple-500/10 text-purple-400";

        const codeContainer = document.createElement('div');
        codeContainer.className = "mt-0 p-4 bg-black/30 rounded-lg border border-white/5 font-mono text-[11px] leading-relaxed text-blue-300 overflow-x-auto max-h-[300px] custom-scrollbar whitespace-pre text-left shadow-inner select-text";
        codeContainer.style.tabSize = '4';
        codeContainer.textContent = sql; // Use textContent to safely show code

        this.message.appendChild(codeContainer);

        // Custom buttons: Copy and Close
        this.actions.innerHTML = '';

        const copyBtn = document.createElement('button');
        copyBtn.className = "px-4 py-2 rounded-lg text-[10px] bg-white/5 font-bold uppercase tracking-wider text-gray-300 hover:text-white hover:bg-white/10 transition-colors";
        copyBtn.innerHTML = `<span class="flex items-center gap-2"><span class="material-symbols-outlined text-[14px]">content_copy</span> Copy</span>`;
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(sql);
            copyBtn.innerHTML = `<span class="flex items-center gap-2"><span class="material-symbols-outlined text-[14px]">check</span> Copied</span>`;
            setTimeout(() => {
                copyBtn.innerHTML = `<span class="flex items-center gap-2"><span class="material-symbols-outlined text-[14px]">content_copy</span> Copy</span>`;
            }, 2000);
        };

        const closeBtn = document.createElement('button');
        closeBtn.className = "px-4 py-2 rounded-lg bg-mysql-teal text-black text-[10px] font-bold uppercase tracking-wider hover:brightness-110 transition-colors";
        closeBtn.textContent = "Close";
        closeBtn.onclick = () => {
            this.close();
            this.dialog.style.width = '400px'; // Reset width
        };

        this.actions.appendChild(copyBtn);
        this.actions.appendChild(closeBtn);
    }
}
