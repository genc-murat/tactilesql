/**
 * Global Keyboard Shortcuts Manager for TactileSQL
 * Provides centralized keyboard shortcut handling across the application
 */

// Shortcut definitions with descriptions
const SHORTCUTS = {
    // Query execution
    'ctrl+enter': { action: 'executeQuery', description: 'Execute query', category: 'Query' },
    'f5': { action: 'executeQuery', description: 'Execute query', category: 'Query' },

    // Tab management
    'ctrl+n': { action: 'newTab', description: 'New tab', category: 'Tabs' },
    'ctrl+w': { action: 'closeTab', description: 'Close tab', category: 'Tabs' },
    'ctrl+tab': { action: 'nextTab', description: 'Next tab', category: 'Tabs' },
    'ctrl+shift+tab': { action: 'prevTab', description: 'Previous tab', category: 'Tabs' },
    'ctrl+1': { action: 'goToTab1', description: 'Tab 1', category: 'Tabs' },
    'ctrl+2': { action: 'goToTab2', description: 'Tab 2', category: 'Tabs' },
    'ctrl+3': { action: 'goToTab3', description: 'Tab 3', category: 'Tabs' },
    'ctrl+4': { action: 'goToTab4', description: 'Tab 4', category: 'Tabs' },
    'ctrl+5': { action: 'goToTab5', description: 'Tab 5', category: 'Tabs' },

    // Editor actions
    'ctrl+s': { action: 'saveSnippet', description: 'Save as snippet', category: 'Editor' },
    'ctrl+shift+f': { action: 'formatSQL', description: 'Format SQL', category: 'Editor' },
    'ctrl+/': { action: 'toggleComment', description: 'Toggle comment', category: 'Editor' },
    'ctrl+d': { action: 'duplicateLine', description: 'Duplicate line', category: 'Editor' },
    'ctrl+l': { action: 'selectLine', description: 'Select line', category: 'Editor' },
    'ctrl+g': { action: 'gotoLine', description: 'Go to line', category: 'Editor' },
    'ctrl+space': { action: 'autocomplete', description: 'Autocomplete', category: 'Editor' },
    'alt+arrowup': { action: 'moveLineUp', description: 'Move line up', category: 'Editor' },
    'alt+arrowdown': { action: 'moveLineDown', description: 'Move line down', category: 'Editor' },

    // Find & Replace
    'ctrl+f': { action: 'find', description: 'Find', category: 'Search' },
    'ctrl+h': { action: 'findReplace', description: 'Find and replace', category: 'Search' },
    'f3': { action: 'findNext', description: 'Find next', category: 'Search' },
    'shift+f3': { action: 'findPrev', description: 'Find previous', category: 'Search' },

    // Navigation
    'ctrl+shift+e': { action: 'focusExplorer', description: 'Focus Object Explorer', category: 'Navigation' },
    'ctrl+shift+q': { action: 'focusQuery', description: 'Focus Query Editor', category: 'Navigation' },
    'ctrl+shift+r': { action: 'focusResults', description: 'Focus Results', category: 'Navigation' },
    'ctrl+shift+s': { action: 'focusSnippets', description: 'Focus Snippets', category: 'Navigation' },

    // General
    'escape': { action: 'closeModal', description: 'Close modal/popup', category: 'General' },
    'f1': { action: 'showHelp', description: 'Shortcut help', category: 'General' },
    'ctrl+shift+?': { action: 'showHelp', description: 'Shortcut help', category: 'General' },

    // Data operations
    'ctrl+shift+c': { action: 'copyAsSQL', description: 'Copy as SQL', category: 'Data' },
    'ctrl+shift+x': { action: 'exportCSV', description: 'Export as CSV', category: 'Data' },

    // Tools
    'ctrl+shift+p': { action: 'toggleProfiler', description: 'Toggle Query Profiler', category: 'Tools' },
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
        'goToTab3', 'goToTab4', 'goToTab5', 'toggleProfiler'];

    // Editor shortcuts should work even when editing
    const editorShortcuts = ['formatSQL', 'toggleComment', 'duplicateLine', 'selectLine',
        'gotoLine', 'autocomplete', 'moveLineUp', 'moveLineDown',
        'find', 'findReplace', 'findNext', 'findPrev', 'saveSnippet'];

    // Check if we should handle this shortcut
    if (isEditing && !globalShortcuts.includes(shortcut.action) && !editorShortcuts.includes(shortcut.action)) {
        return;
    }

    // ALWAYS prevent default for registered shortcuts to avoid browser conflicts
    // This prevents issues like Ctrl+S triggering browser save, Ctrl+N opening new window, etc.
    e.preventDefault();
    e.stopPropagation();

    const handler = handlers[shortcut.action];

    if (handler) {
        handler(e);
    } else if (shortcut.action === 'showHelp') {
        showShortcutsHelp();
    } else if (shortcut.action === 'closeModal') {
        closeActiveModal();
    } else if (shortcut.action === 'toggleProfiler') {
        window.dispatchEvent(new CustomEvent('tactilesql:toggle-profiler'));
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

    // Define category order for better organization
    const categoryOrder = ['Query', 'Editor', 'Navigation', 'Tabs', 'Search', 'Data', 'Tools', 'General'];
    const orderedCategories = categoryOrder
        .filter(cat => categories[cat])
        .map(cat => [cat, categories[cat]]);

    modal.innerHTML = `
        <div class="bg-[#16191e] border border-white/10 rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-gradient-to-r from-[#16191e] to-[#1a1d23]">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-mysql-teal text-xl">keyboard</span>
                    <h2 class="text-base font-semibold text-white">Keyboard Shortcuts</h2>
                    <span id="shortcut-count" class="text-xs text-gray-500 ml-2">${Object.keys(SHORTCUTS).length} shortcuts</span>
                </div>
                <button id="close-shortcut-modal" class="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                    <span class="material-symbols-outlined text-gray-400 hover:text-white text-lg">close</span>
                </button>
            </div>
            <div class="px-4 pt-3 pb-2 border-b border-white/5">
                <div class="relative">
                    <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">search</span>
                    <input 
                        type="text" 
                        id="shortcut-search" 
                        placeholder="Search shortcuts or descriptions..." 
                        class="w-full bg-[#0f1115] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-mysql-teal/50 focus:bg-[#1a1d23] transition-colors"
                        autocomplete="off"
                        spellcheck="false"
                    />
                    <button id="clear-search" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors hidden">
                        <span class="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>
            </div>
            <div id="shortcuts-container" class="flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
                <div class="space-y-3">
                    ${orderedCategories.map(([category, shortcuts]) => `
                        <div class="shortcut-category border-b border-white/5 pb-3 last:border-0" data-category="${category}">
                            <div class="flex items-center gap-1.5 mb-2 sticky top-0 bg-[#16191e] py-1">
                                <span class="material-symbols-outlined text-mysql-teal text-sm">${getCategoryIcon(category)}</span>
                                <h3 class="text-xs font-semibold text-mysql-teal uppercase tracking-wide">${category}</h3>
                            </div>
                            <div class="grid grid-cols-1 gap-1">
                                ${shortcuts.map(s => `
                                    <div class="shortcut-item flex items-center justify-between py-1 px-2 hover:bg-white/5 rounded transition-colors group" 
                                         data-description="${s.description.toLowerCase()}" 
                                         data-key="${s.key.toLowerCase()}" 
                                         data-action="${s.action.toLowerCase()}">
                                        <span class="text-gray-300 text-xs group-hover:text-white transition-colors">${s.description}</span>
                                        <kbd class="px-2 py-0.5 bg-[#0f1115] border border-white/10 rounded text-[11px] text-gray-400 font-mono shadow-sm whitespace-nowrap ml-3">
                                            ${formatKeyCombo(s.key)}
                                        </kbd>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div id="no-results" class="hidden text-center py-12">
                    <span class="material-symbols-outlined text-gray-600 text-5xl mb-3">search_off</span>
                    <p class="text-gray-500 text-sm">No shortcuts found</p>
                    <p class="text-gray-600 text-xs mt-1">Try a different search term</p>
                </div>
            </div>
            <div class="px-4 py-2 border-t border-white/5 bg-[#0f1115] text-center">
                <span class="text-[10px] text-gray-500">
                    Press <kbd class="px-1 py-0.5 bg-[#16191e] border border-white/10 rounded text-[10px] text-gray-400">ESC</kbd> to close
                </span>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Search functionality
    const searchInput = document.getElementById('shortcut-search');
    const clearBtn = document.getElementById('clear-search');
    const shortcutItems = document.querySelectorAll('.shortcut-item');
    const categoryDivs = document.querySelectorAll('.shortcut-category');
    const noResults = document.getElementById('no-results');
    const shortcutCount = document.getElementById('shortcut-count');
    const container = document.getElementById('shortcuts-container');

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        // Show/hide clear button
        clearBtn.classList.toggle('hidden', !query);
        
        let visibleCount = 0;
        let hasVisibleCategories = false;

        if (!query) {
            // Show all items
            shortcutItems.forEach(item => item.classList.remove('hidden'));
            categoryDivs.forEach(cat => cat.classList.remove('hidden'));
            noResults.classList.add('hidden');
            container.classList.remove('hidden');
            shortcutCount.textContent = `${Object.keys(SHORTCUTS).length} shortcuts`;
            return;
        }

        // Filter items
        shortcutItems.forEach(item => {
            const description = item.dataset.description;
            const key = item.dataset.key;
            const action = item.dataset.action;
            const matches = description.includes(query) || 
                           key.includes(query) || 
                           action.includes(query);
            
            item.classList.toggle('hidden', !matches);
            if (matches) visibleCount++;
        });

        // Hide empty categories
        categoryDivs.forEach(cat => {
            const visibleItems = cat.querySelectorAll('.shortcut-item:not(.hidden)');
            const hasVisible = visibleItems.length > 0;
            cat.classList.toggle('hidden', !hasVisible);
            if (hasVisible) hasVisibleCategories = true;
        });

        // Show/hide no results message
        if (!hasVisibleCategories) {
            noResults.classList.remove('hidden');
            container.classList.add('hidden');
        } else {
            noResults.classList.add('hidden');
            container.classList.remove('hidden');
        }

        // Update count
        shortcutCount.textContent = `${visibleCount} shortcut${visibleCount !== 1 ? 's' : ''}`;
    });

    // Clear search
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        searchInput.focus();
    });

    // Focus search on open
    setTimeout(() => searchInput.focus(), 100);

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
        'Data': 'table_chart',
        'Tools': 'build'
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
