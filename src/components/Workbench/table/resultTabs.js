// Result Tabs Management for ResultsTable
// Extracted from ResultsTable.js for modularity

const MAX_TABS = 10;

/**
 * Generate unique tab ID
 * @returns {string}
 */
export const generateTabId = () => {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Creates a result tabs manager
 * @returns {Object} Tab manager instance
 */
export const createResultTabsManager = () => {
    let tabs = [];
    let activeTabId = null;

    return {
        /**
         * Get all tabs
         * @returns {Array}
         */
        getTabs() {
            return [...tabs];
        },

        /**
         * Get active tab ID
         * @returns {string|null}
         */
        getActiveTabId() {
            return activeTabId;
        },

        /**
         * Get active tab
         * @returns {Object|null}
         */
        getActiveTab() {
            return tabs.find(t => t.id === activeTabId) || null;
        },

        /**
         * Add a new result tab
         * @param {string} query - The query that produced this result
         * @param {Object} data - Result data {columns, rows, metadata}
         * @param {string} titleOverride - Optional custom title
         * @returns {string} New tab ID
         */
        addTab(query, data, titleOverride = null) {
            const id = generateTabId();
            let title = titleOverride;

            if (!title) {
                title = query.trim().substring(0, 30) + (query.length > 30 ? '...' : '');
            }

            // Remove oldest unpinned tab if at max
            if (tabs.length >= MAX_TABS) {
                const unpinnedIdx = tabs.findIndex(t => !t.pinned);
                if (unpinnedIdx !== -1) {
                    tabs.splice(unpinnedIdx, 1);
                }
            }

            tabs.push({
                id,
                title,
                query,
                data: { ...data },
                timestamp: Date.now(),
                pinned: false
            });

            activeTabId = id;
            return id;
        },

        /**
         * Remove a result tab
         * @param {string} tabId - Tab ID to remove
         */
        removeTab(tabId) {
            const idx = tabs.findIndex(t => t.id === tabId);
            if (idx === -1) return;

            tabs.splice(idx, 1);

            if (activeTabId === tabId) {
                if (tabs.length > 0) {
                    const newIdx = Math.min(idx, tabs.length - 1);
                    activeTabId = tabs[newIdx].id;
                } else {
                    activeTabId = null;
                }
            }
        },

        /**
         * Toggle pin state of a tab
         * @param {string} tabId - Tab ID to toggle
         */
        togglePin(tabId) {
            const tab = tabs.find(t => t.id === tabId);
            if (tab) {
                tab.pinned = !tab.pinned;
            }
        },

        /**
         * Set active tab
         * @param {string} tabId - Tab ID to activate
         * @returns {Object|null} Active tab data or null
         */
        setActiveTab(tabId) {
            const tab = tabs.find(t => t.id === tabId);
            if (tab) {
                activeTabId = tabId;
                return tab.data;
            }
            return null;
        },

        /**
         * Clear all tabs
         */
        clearAll() {
            tabs = [];
            activeTabId = null;
        },

        /**
         * Clear unpinned tabs only
         */
        clearUnpinned() {
            tabs = tabs.filter(t => t.pinned);
            if (tabs.length > 0 && !tabs.find(t => t.id === activeTabId)) {
                activeTabId = tabs[0].id;
            } else if (tabs.length === 0) {
                activeTabId = null;
            }
        },

        /**
         * Check if there are any tabs
         * @returns {boolean}
         */
        hasTabs() {
            return tabs.length > 0;
        },

        /**
         * Get tab count
         * @returns {number}
         */
        getTabCount() {
            return tabs.length;
        },

        /**
         * Get sorted tabs (pinned first)
         * @returns {Array}
         */
        getSortedTabs() {
            const pinned = tabs.filter(t => t.pinned);
            const unpinned = tabs.filter(t => !t.pinned);
            return [...pinned, ...unpinned];
        }
    };
};
