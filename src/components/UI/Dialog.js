export class Dialog {
    static init() {
        if (document.getElementById('tactile-dialog-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'tactile-dialog-overlay';
        overlay.className = "fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] hidden flex items-center justify-center opacity-0 transition-opacity duration-200";

        overlay.innerHTML = `
            <div id="tactile-dialog" class="bg-[#16191e] border border-white/10 rounded-2xl w-[400px] shadow-2xl scale-95 transition-transform duration-200 overflow-hidden relative">
                <div class="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-neon-cyan to-purple-500"></div>
                <div class="p-6 pt-8 text-center space-y-4">
                    <div id="dialog-icon-container" class="mx-auto size-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
                        <span id="dialog-icon" class="material-symbols-outlined text-2xl text-white">info</span>
                    </div>
                    <h3 id="dialog-title" class="text-sm font-black uppercase tracking-[0.2em] text-white">Notification</h3>
                    <p id="dialog-message" class="text-[11px] text-gray-400 font-mono leading-relaxed whitespace-pre-wrap"></p>
                </div>
                <div id="dialog-actions" class="p-4 bg-white/5 flex gap-3 justify-center border-t border-white/5">
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

        this.title.textContent = title || 'Notification';
        this.message.textContent = message || '';

        // Reset styles based on type
        this.iconContainer.className = "mx-auto size-12 rounded-full flex items-center justify-center mb-4 border border-white/10";
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

        this.show({
            title,
            message,
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

            this.title.textContent = title;
            this.message.textContent = message;

            // Custom Content for Input
            const inputContainer = document.createElement('div');
            inputContainer.className = "mt-3";
            inputContainer.innerHTML = `
                <input type="text" id="dialog-prompt-input" class="w-full bg-[#0b0d11] border border-white/10 rounded p-2 text-xs text-gray-300 focus:border-mysql-teal/50 outline-none" value="${defaultValue}" />
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
}
