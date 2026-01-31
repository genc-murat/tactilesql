/**
 * Global Keyboard Shortcuts Manager for TactileSQL
 * Provides centralized keyboard shortcut handling across the application
 */

// Shortcut definitions with descriptions
const SHORTCUTS = {
    // Query execution
    'ctrl+enter': { action: 'executeQuery', description: 'Sorguyu çalıştır', category: 'Query' },
    'f5': { action: 'executeQuery', description: 'Sorguyu çalıştır', category: 'Query' },

    // Tab management
    'ctrl+n': { action: 'newTab', description: 'Yeni sekme', category: 'Tabs' },
    'ctrl+w': { action: 'closeTab', description: 'Sekmeyi kapat', category: 'Tabs' },
    'ctrl+tab': { action: 'nextTab', description: 'Sonraki sekme', category: 'Tabs' },
    'ctrl+shift+tab': { action: 'prevTab', description: 'Önceki sekme', category: 'Tabs' },
    'ctrl+1': { action: 'goToTab1', description: 'Sekme 1', category: 'Tabs' },
    'ctrl+2': { action: 'goToTab2', description: 'Sekme 2', category: 'Tabs' },
    'ctrl+3': { action: 'goToTab3', description: 'Sekme 3', category: 'Tabs' },
    'ctrl+4': { action: 'goToTab4', description: 'Sekme 4', category: 'Tabs' },
    'ctrl+5': { action: 'goToTab5', description: 'Sekme 5', category: 'Tabs' },

    // Editor actions
    'ctrl+s': { action: 'saveSnippet', description: 'Snippet olarak kaydet', category: 'Editor' },
    'ctrl+shift+f': { action: 'formatSQL', description: 'SQL formatla', category: 'Editor' },
    'ctrl+/': { action: 'toggleComment', description: 'Yorum ekle/kaldır', category: 'Editor' },
    'ctrl+d': { action: 'duplicateLine', description: 'Satırı çoğalt', category: 'Editor' },
    'ctrl+l': { action: 'selectLine', description: 'Satırı seç', category: 'Editor' },
    'ctrl+g': { action: 'gotoLine', description: 'Satıra git', category: 'Editor' },
    'ctrl+space': { action: 'autocomplete', description: 'Otomatik tamamla', category: 'Editor' },
    'alt+arrowup': { action: 'moveLineUp', description: 'Satırı yukarı taşı', category: 'Editor' },
    'alt+arrowdown': { action: 'moveLineDown', description: 'Satırı aşağı taşı', category: 'Editor' },

    // Find & Replace
    'ctrl+f': { action: 'find', description: 'Bul', category: 'Search' },
    'ctrl+h': { action: 'findReplace', description: 'Bul ve değiştir', category: 'Search' },
    'f3': { action: 'findNext', description: 'Sonrakini bul', category: 'Search' },
    'shift+f3': { action: 'findPrev', description: 'Öncekini bul', category: 'Search' },

    // Navigation
    'ctrl+shift+e': { action: 'focusExplorer', description: 'Object Explorer\'a odaklan', category: 'Navigation' },
    'ctrl+shift+q': { action: 'focusQuery', description: 'Query Editor\'a odaklan', category: 'Navigation' },
    'ctrl+shift+r': { action: 'focusResults', description: 'Results\'a odaklan', category: 'Navigation' },
    'ctrl+shift+s': { action: 'focusSnippets', description: 'Snippets\'a odaklan', category: 'Navigation' },

    // General
    'escape': { action: 'closeModal', description: 'Modal/popup kapat', category: 'General' },
    'f1': { action: 'showHelp', description: 'Kısayol yardımı', category: 'General' },
    'ctrl+shift+?': { action: 'showHelp', description: 'Kısayol yardımı', category: 'General' },

    // Data operations
    'ctrl+shift+c': { action: 'copyAsSQL', description: 'SQL olarak kopyala', category: 'Data' },
    'ctrl+shift+x': { action: 'exportCSV', description: 'CSV olarak dışa aktar', category: 'Data' },
};

// Action handlers - will be set by components
const handlers = {};

/**
 * Register a handler for a specific action
 * @param {string} action - Action name
 * @param {Function} handler - Handler function
 */
export function registerHandler(action, handler) {
    handlers[action] = handler;
}

/**
 * Unregister a handler for a specific action
 * @param {string} action - Action name
 */
export function unregisterHandler(action) {
    delete handlers[action];
}

/**
 * Normalize key combination from event
 * @param {KeyboardEvent} e - Keyboard event
 * @returns {string} Normalized key string
 */
function normalizeKey(e) {
    const parts = [];

    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');

    // Normalize key name
    let key = e.key.toLowerCase();
    if (key === ' ') key = 'space';
    if (key === 'escape') key = 'escape';

    // Handle special keys
    if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
        parts.push(key);
    }

    return parts.join('+');
}

/**
 * Global keyboard event handler
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleKeydown(e) {
    // Don't handle if user is typing in an input/textarea (unless it's a global shortcut)
    const target = e.target;
    const isEditing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    const keyCombo = normalizeKey(e);
    const shortcut = SHORTCUTS[keyCombo];

    if (!shortcut) return;

    // Some shortcuts should only work in specific contexts
    const globalShortcuts = ['executeQuery', 'newTab', 'closeTab', 'nextTab', 'prevTab',
        'showHelp', 'closeModal', 'focusExplorer', 'focusQuery',
        'focusResults', 'focusSnippets', 'goToTab1', 'goToTab2',
        'goToTab3', 'goToTab4', 'goToTab5'];

    // Editor shortcuts should work even when editing
    const editorShortcuts = ['formatSQL', 'toggleComment', 'duplicateLine', 'selectLine',
        'gotoLine', 'autocomplete', 'moveLineUp', 'moveLineDown',
        'find', 'findReplace', 'findNext', 'findPrev', 'saveSnippet'];

    // Check if we should handle this shortcut
    if (isEditing && !globalShortcuts.includes(shortcut.action) && !editorShortcuts.includes(shortcut.action)) {
        return;
    }

    const handler = handlers[shortcut.action];

    if (handler) {
        e.preventDefault();
        e.stopPropagation();
        handler(e);
    } else if (shortcut.action === 'showHelp') {
        e.preventDefault();
        showShortcutsHelp();
    } else if (shortcut.action === 'closeModal') {
        e.preventDefault();
        closeActiveModal();
    }
}

/**
 * Close any active modal
 */
function closeActiveModal() {
    // Close dialog overlays
    const overlays = document.querySelectorAll('.dialog-overlay, #shortcut-help-modal');
    overlays.forEach(overlay => overlay.remove());

    // Close autocomplete
    const autocomplete = document.querySelector('#autocomplete-popup');
    if (autocomplete) autocomplete.remove();

    // Close context menus
    const contextMenus = document.querySelectorAll('.context-menu');
    contextMenus.forEach(menu => menu.remove());
}

/**
 * Show keyboard shortcuts help modal
 */
export function showShortcutsHelp() {
    // Remove existing modal if any
    const existing = document.getElementById('shortcut-help-modal');
    if (existing) {
        existing.remove();
        return;
    }

    // Group shortcuts by category
    const categories = {};
    Object.entries(SHORTCUTS).forEach(([key, value]) => {
        if (!categories[value.category]) {
            categories[value.category] = [];
        }
        categories[value.category].push({ key, ...value });
    });

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'shortcut-help-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fadeIn';

    modal.innerHTML = `
        <div class="bg-[#16191e] border border-white/10 rounded-2xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-mysql-teal text-2xl">keyboard</span>
                    <h2 class="text-xl font-semibold text-white">Klavye Kısayolları</h2>
                </div>
                <button id="close-shortcut-modal" class="p-2 rounded-lg hover:bg-white/10 transition-colors">
                    <span class="material-symbols-outlined text-gray-400 hover:text-white">close</span>
                </button>
            </div>
            <div class="flex-1 overflow-y-auto custom-scrollbar p-5">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    ${Object.entries(categories).map(([category, shortcuts]) => `
                        <div class="bg-[#0f1115] rounded-xl p-4 border border-white/5">
                            <h3 class="text-mysql-teal font-medium mb-3 flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">${getCategoryIcon(category)}</span>
                                ${category}
                            </h3>
                            <div class="space-y-2">
                                ${shortcuts.map(s => `
                                    <div class="flex items-center justify-between py-1.5 hover:bg-white/5 rounded px-2 -mx-2 transition-colors">
                                        <span class="text-gray-400 text-sm">${s.description}</span>
                                        <kbd class="px-2 py-1 bg-[#1a1d23] border border-white/10 rounded text-xs text-gray-300 font-mono shadow-sm">
                                            ${formatKeyCombo(s.key)}
                                        </kbd>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="p-4 border-t border-white/5 text-center text-xs text-gray-500">
                <span class="material-symbols-outlined text-[10px] align-middle">info</span>
                Kısayolları gizlemek için <kbd class="px-1.5 py-0.5 bg-[#1a1d23] border border-white/10 rounded text-[10px]">ESC</kbd> veya <kbd class="px-1.5 py-0.5 bg-[#1a1d23] border border-white/10 rounded text-[10px]">F1</kbd> tuşuna basın
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    document.getElementById('close-shortcut-modal').onclick = () => modal.remove();
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

/**
 * Get icon for category
 */
function getCategoryIcon(category) {
    const icons = {
        'Query': 'play_arrow',
        'Tabs': 'tab',
        'Editor': 'edit',
        'Search': 'search',
        'Navigation': 'explore',
        'General': 'settings',
        'Data': 'table_chart'
    };
    return icons[category] || 'keyboard';
}

/**
 * Format key combination for display
 */
function formatKeyCombo(key) {
    return key
        .split('+')
        .map(k => {
            switch (k) {
                case 'ctrl': return 'Ctrl';
                case 'alt': return 'Alt';
                case 'shift': return 'Shift';
                case 'enter': return '↵';
                case 'escape': return 'Esc';
                case 'arrowup': return '↑';
                case 'arrowdown': return '↓';
                case 'arrowleft': return '←';
                case 'arrowright': return '→';
                case 'space': return 'Space';
                case 'tab': return 'Tab';
                default: return k.toUpperCase();
            }
        })
        .join(' + ');
}

/**
 * Initialize keyboard shortcuts
 */
export function initKeyboardShortcuts() {
    document.addEventListener('keydown', handleKeydown);
    console.log('⌨️ Keyboard shortcuts initialized');
}

/**
 * Cleanup keyboard shortcuts
 */
export function destroyKeyboardShortcuts() {
    document.removeEventListener('keydown', handleKeydown);
}

/**
 * Get all shortcuts for documentation
 */
export function getAllShortcuts() {
    return { ...SHORTCUTS };
}

export default {
    init: initKeyboardShortcuts,
    destroy: destroyKeyboardShortcuts,
    register: registerHandler,
    unregister: unregisterHandler,
    showHelp: showShortcutsHelp,
    getAll: getAllShortcuts
};
