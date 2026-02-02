// Tab State Management for Query Editor
// Extracted from QueryEditor.js for modularity

const STORAGE_KEY = 'workbench_tabs_state';

/**
 * Default tab structure
 */
const createDefaultTab = (id = '1', num = 1) => ({
    id,
    title: `Query ${num}`,
    content: '',
    pinned: false,
    connectionName: '',
    connectionColor: ''
});

/**
 * Load tabs from localStorage
 * @returns {{tabs: Array, activeTabId: string}}
 */
export const loadTabsState = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            let tabs = parsed.tabs || [createDefaultTab()];
            let activeTabId = parsed.activeTabId || tabs[0]?.id || '1';

            // Ensure at least one tab exists
            if (tabs.length === 0) {
                tabs = [createDefaultTab()];
                activeTabId = '1';
            }

            // Ensure all tabs have pinned property (backwards compatibility)
            tabs = tabs.map(tab => ({ ...tab, pinned: tab.pinned || false }));

            return { tabs, activeTabId };
        }
    } catch (e) {
        console.warn('Failed to load tabs from localStorage', e);
    }

    return {
        tabs: [createDefaultTab()],
        activeTabId: '1'
    };
};

/**
 * Save tabs state to localStorage
 * @param {Array} tabs - Array of tab objects
 * @param {string} activeTabId - Currently active tab ID
 */
export const saveTabsState = (tabs, activeTabId) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            tabs,
            activeTabId
        }));
    } catch (e) {
        console.warn('Failed to save tabs to localStorage', e);
    }
};

/**
 * Sort tabs: pinned first, then by original order
 * @param {Array} tabs - Array of tab objects
 * @returns {Array}
 */
export const getSortedTabs = (tabs) => {
    const pinnedTabs = tabs.filter(t => t.pinned);
    const unpinnedTabs = tabs.filter(t => !t.pinned);
    return [...pinnedTabs, ...unpinnedTabs];
};

/**
 * Create a new tab
 * @param {Array} tabs - Current tabs array
 * @param {Object} options - Tab options
 * @returns {{tabs: Array, newTabId: string}}
 */
export const createTab = (tabs, options = {}) => {
    const newId = Date.now().toString();
    const num = tabs.length + 1;
    
    const newTab = {
        id: newId,
        title: options.title || `Query ${num}`,
        content: options.content || '',
        pinned: options.pinned || false,
        connectionName: options.connectionName || '',
        connectionColor: options.connectionColor || ''
    };

    return {
        tabs: [...tabs, newTab],
        newTabId: newId
    };
};

/**
 * Close a tab
 * @param {Array} tabs - Current tabs array
 * @param {string} tabId - ID of tab to close
 * @param {string} activeTabId - Currently active tab ID
 * @returns {{tabs: Array, activeTabId: string}}
 */
export const closeTab = (tabs, tabId, activeTabId) => {
    // Don't close if it's the last tab
    if (tabs.length === 1) {
        return { tabs, activeTabId };
    }

    const idx = tabs.findIndex(t => t.id === tabId);
    const newTabs = tabs.filter(t => t.id !== tabId);
    
    let newActiveTabId = activeTabId;
    if (activeTabId === tabId) {
        const newIdx = Math.max(0, idx - 1);
        newActiveTabId = newTabs[newIdx]?.id || newTabs[0]?.id;
    }

    return {
        tabs: newTabs,
        activeTabId: newActiveTabId
    };
};

/**
 * Toggle tab pinned state
 * @param {Array} tabs - Current tabs array
 * @param {string} tabId - ID of tab to toggle
 * @returns {Array}
 */
export const toggleTabPin = (tabs, tabId) => {
    return tabs.map(tab => 
        tab.id === tabId 
            ? { ...tab, pinned: !tab.pinned }
            : tab
    );
};

/**
 * Update tab content
 * @param {Array} tabs - Current tabs array
 * @param {string} tabId - ID of tab to update
 * @param {string} content - New content
 * @returns {Array}
 */
export const updateTabContent = (tabs, tabId, content) => {
    return tabs.map(tab =>
        tab.id === tabId
            ? { ...tab, content }
            : tab
    );
};

/**
 * Get tab by ID
 * @param {Array} tabs - Array of tabs
 * @param {string} tabId - Tab ID to find
 * @returns {Object|undefined}
 */
export const getTabById = (tabs, tabId) => {
    return tabs.find(t => t.id === tabId);
};

/**
 * Move tab to a specific position (for drag-drop or overflow menu)
 * @param {Array} tabs - Current tabs array
 * @param {string} tabId - ID of tab to move
 * @param {number} newIndex - New position index
 * @returns {Array}
 */
export const moveTab = (tabs, tabId, newIndex) => {
    const currentIndex = tabs.findIndex(t => t.id === tabId);
    if (currentIndex === -1 || currentIndex === newIndex) {
        return tabs;
    }

    const newTabs = [...tabs];
    const [movedTab] = newTabs.splice(currentIndex, 1);
    newTabs.splice(newIndex, 0, movedTab);

    return newTabs;
};
