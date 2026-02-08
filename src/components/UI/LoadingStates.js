import { ThemeManager } from '../../utils/ThemeManager.js';

/**
 * Loading States Component - Provides skeleton loaders and progress indicators
 * Now with global loading manager for consistent async operation handling
 */

// Track active loading states globally
const activeLoadingStates = new Map();

/**
 * Global Loading Manager - Wrap async operations with consistent loading states
 */
export const LoadingManager = {
    /**
     * Wrap an async operation with loading indicator
     * @param {string} key - Unique identifier for this loading state
     * @param {HTMLElement} container - Container to show loading in (optional)
     * @param {Function} asyncFn - Async function to execute
     * @param {Object} options - Options for loading display
     * @returns {Promise<any>} Result of the async function
     */
    async wrap(key, container, asyncFn, options = {}) {
        const {
            message = 'Loading...',
            type = 'overlay', // 'overlay' | 'inline' | 'spinner' | 'skeleton'
            minDuration = 0, // Minimum display time to prevent flashing
            onStart = null,
            onEnd = null,
        } = options;

        const startTime = Date.now();
        let loadingElement = null;

        try {
            // Mark as loading
            activeLoadingStates.set(key, true);

            // Create loading indicator
            if (container) {
                container.style.position = 'relative';

                switch (type) {
                    case 'overlay':
                        loadingElement = LoadingStates.overlay(message);
                        break;
                    case 'inline':
                        loadingElement = LoadingStates.inlineText(message);
                        break;
                    case 'spinner':
                        loadingElement = document.createElement('div');
                        loadingElement.className = 'absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm z-50';
                        loadingElement.appendChild(LoadingStates.spinner('lg'));
                        break;
                    case 'skeleton':
                        loadingElement = LoadingStates.tableSkeleton();
                        break;
                    default:
                        loadingElement = LoadingStates.overlay(message);
                }

                loadingElement.dataset.loadingKey = key;
                container.appendChild(loadingElement);
            }

            // Dispatch loading start event
            window.dispatchEvent(new CustomEvent('loading:start', { detail: { key, message } }));
            onStart?.();

            // Execute async function
            const result = await asyncFn();

            // Ensure minimum duration
            const elapsed = Date.now() - startTime;
            if (minDuration > 0 && elapsed < minDuration) {
                await new Promise(resolve => setTimeout(resolve, minDuration - elapsed));
            }

            return result;
        } finally {
            // Remove loading state
            activeLoadingStates.delete(key);

            // Remove loading indicator
            if (loadingElement && loadingElement.parentNode) {
                loadingElement.remove();
            }

            // Dispatch loading end event
            window.dispatchEvent(new CustomEvent('loading:end', { detail: { key } }));
            onEnd?.();
        }
    },

    /**
     * Check if a specific operation is loading
     * @param {string} key - Loading state key
     * @returns {boolean}
     */
    isLoading(key) {
        return activeLoadingStates.has(key);
    },

    /**
     * Check if any operation is loading
     * @returns {boolean}
     */
    isAnyLoading() {
        return activeLoadingStates.size > 0;
    },

    /**
     * Get all active loading keys
     * @returns {string[]}
     */
    getActiveKeys() {
        return Array.from(activeLoadingStates.keys());
    },

    /**
     * Show a global loading indicator (for app-wide operations)
     * @param {string} message - Loading message
     * @returns {Function} Dismiss function
     */
    showGlobal(message = 'Loading...') {
        const theme = ThemeManager.getCurrentTheme();
        const isNeon = theme === 'neon';
        const overlay = document.createElement('div');
        overlay.id = 'global-loading-overlay';
        overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999]';
        overlay.innerHTML = `
            <div class="${isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-[#16191e] border border-white/10'} rounded-xl p-6 flex flex-col items-center gap-4 shadow-2xl">
                <div class="relative">
                    <div class="w-12 h-12 rounded-full border-4 ${isNeon ? 'border-white/5 border-t-neon-accent' : 'border-white/10 border-t-mysql-teal'} animate-spin"></div>
                </div>
                <span class="text-sm ${isNeon ? 'text-neon-text' : 'text-gray-300'}">${message}</span>
            </div>
        `;
        document.body.appendChild(overlay);

        return () => overlay.remove();
    },

    /**
     * Show button loading state
     * @param {HTMLButtonElement} button - Button element
     * @param {boolean} loading - Loading state
     * @param {string} loadingText - Text to show while loading
     */
    setButtonLoading(button, loading, loadingText = 'Loading...') {
        if (!button) return;

        if (loading) {
            button.dataset.originalText = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `
                <span class="inline-flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    ${loadingText}
                </span>
            `;
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalText || button.innerHTML;
        }
    }
};

export const LoadingStates = {
    /**
     * Create a skeleton loader element
     * @param {Object} options - Configuration options
     * @returns {HTMLElement}
     */
    skeleton({ width = '100%', height = '16px', rounded = 'md', className = '' } = {}) {
        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';

        const el = document.createElement('div');
        el.className = `animate-pulse ${isLight ? 'bg-gray-200' : (isDawn ? 'bg-[#e4ddd5]' : (isOceanic ? 'bg-ocean-border/30' : (isNeon ? 'bg-neon-accent/10' : 'bg-white/10')))} rounded-${rounded} ${className}`;
        el.style.width = width;
        el.style.height = height;
        return el;
    },

    /**
     * Create table skeleton loader
     * @param {number} rows - Number of skeleton rows
     * @param {number} cols - Number of skeleton columns
     * @returns {HTMLElement}
     */
    tableSkeleton(rows = 8, cols = 5) {
        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';

        const container = document.createElement('div');
        container.className = 'w-full';

        // Header
        const header = document.createElement('div');
        header.className = `flex gap-4 p-3 border-b ${isLight ? 'border-gray-200 bg-gray-50' : (isDawn ? 'border-[#f2e9e1] bg-[#faf4ed]' : (isOceanic ? 'border-ocean-border bg-ocean-panel' : (isNeon ? 'border-neon-border/20 bg-neon-panel' : 'border-white/5 bg-[#16191e]')))}`;

        for (let i = 0; i < cols; i++) {
            const headerCell = document.createElement('div');
            headerCell.className = `animate-pulse ${isLight ? 'bg-gray-300/50' : (isDawn ? 'bg-[#d8d1cf]' : (isOceanic ? 'bg-ocean-border/40' : (isNeon ? 'bg-neon-accent/10' : 'bg-white/10')))} rounded h-4 flex-1`;
            headerCell.style.animationDelay = `${i * 100}ms`;
            header.appendChild(headerCell);
        }
        container.appendChild(header);

        // Rows
        for (let r = 0; r < rows; r++) {
            const row = document.createElement('div');
            row.className = `flex gap-4 p-3 border-b ${isLight ? 'border-gray-100' : (isDawn ? 'border-[#f2e9e1]/50' : (isOceanic ? 'border-ocean-border/30' : (isNeon ? 'border-neon-border/10' : 'border-white/[0.03]')))}`;
            row.style.opacity = `${1 - (r * 0.08)}`;

            for (let c = 0; c < cols; c++) {
                const cell = document.createElement('div');
                cell.className = `animate-pulse ${isLight ? 'bg-gray-200/60' : (isDawn ? 'bg-[#e4ddd5]/60' : (isOceanic ? 'bg-ocean-border/20' : (isNeon ? 'bg-neon-accent/5' : 'bg-white/5')))} rounded h-3 flex-1`;
                cell.style.width = `${40 + Math.random() * 50}%`;
                cell.style.animationDelay = `${(r * cols + c) * 50}ms`;
                row.appendChild(cell);
            }
            container.appendChild(row);
        }

        return container;
    },

    /**
     * Create a card skeleton loader
     * @returns {HTMLElement}
     */
    cardSkeleton() {
        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';

        const card = document.createElement('div');
        card.className = `p-4 rounded-xl border ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-[#16191e] border-white/5')))}`;
        card.innerHTML = `
            <div class="flex items-center gap-3 mb-4">
                <div class="animate-pulse w-10 h-10 rounded-lg ${isLight ? 'bg-gray-200' : (isDawn ? 'bg-[#e4ddd5]' : (isOceanic ? 'bg-ocean-border/30' : (isNeon ? 'bg-neon-accent/10' : 'bg-white/10')))}"></div>
                <div class="flex-1">
                    <div class="animate-pulse h-4 ${isLight ? 'bg-gray-200' : (isDawn ? 'bg-[#e4ddd5]' : (isOceanic ? 'bg-ocean-border/30' : (isNeon ? 'bg-neon-accent/10' : 'bg-white/10')))} rounded w-3/4 mb-2"></div>
                    <div class="animate-pulse h-3 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : (isOceanic ? 'bg-ocean-border/20' : (isNeon ? 'bg-neon-accent/5' : 'bg-white/5')))} rounded w-1/2"></div>
                </div>
            </div>
            <div class="space-y-2">
                <div class="animate-pulse h-3 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : (isOceanic ? 'bg-ocean-border/20' : (isNeon ? 'bg-neon-accent/5' : 'bg-white/5')))} rounded"></div>
                <div class="animate-pulse h-3 ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : (isOceanic ? 'bg-ocean-border/20' : (isNeon ? 'bg-neon-accent/5' : 'bg-white/5')))} rounded w-5/6"></div>
            </div>
        `;
        return card;
    },

    /**
     * Create a spinning loader
     * @param {string} size - Size class (sm, md, lg)
     * @param {string} color - Color class
     * @returns {HTMLElement}
     */
    spinner(size = 'md', color = 'text-mysql-teal') {
        const sizes = {
            sm: 'w-4 h-4',
            md: 'w-6 h-6',
            lg: 'w-8 h-8',
            xl: 'w-12 h-12'
        };

        const spinner = document.createElement('div');
        spinner.className = `${sizes[size]} ${color} animate-spin`;
        spinner.innerHTML = `
            <svg class="w-full h-full" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
        `;
        return spinner;
    },

    /**
     * Create a progress bar
     * @param {number} progress - Progress percentage (0-100)
     * @param {boolean} animated - Whether to animate
     * @returns {HTMLElement}
     */
    progressBar(progress = 0, animated = true) {
        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';

        const container = document.createElement('div');
        container.className = `w-full h-2 rounded-full ${isLight ? 'bg-gray-200' : (isDawn ? 'bg-[#e4ddd5]' : (isOceanic ? 'bg-ocean-border/30' : (isNeon ? 'bg-neon-accent/10' : 'bg-white/10')))} overflow-hidden`;

        const bar = document.createElement('div');
        bar.className = `h-full bg-gradient-to-r ${isNeon ? 'from-neon-accent to-neon-cyan' : 'from-mysql-teal to-mysql-cyan'} rounded-full transition-all duration-300 ${animated ? 'animate-pulse' : ''}`;
        bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;

        container.appendChild(bar);
        return container;
    },

    /**
     * Create a loading overlay for containers
     * @param {string} message - Loading message
     * @returns {HTMLElement}
     */
    overlay(message = 'Loading...') {
        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
        const isNeon = theme === 'neon';

        const overlay = document.createElement('div');
        overlay.className = `absolute inset-0 ${isLight ? 'bg-white/80' : (isDawn ? 'bg-[#faf4ed]/80' : (isOceanic ? 'bg-ocean-bg/80' : (isNeon ? 'bg-neon-bg/80' : 'bg-black/60')))} backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-50`;
        overlay.innerHTML = `
            <div class="relative">
                <div class="w-12 h-12 rounded-full border-4 ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : (isOceanic ? 'border-ocean-border' : (isNeon ? 'border-neon-border/20' : 'border-white/10')))} border-t-mysql-teal animate-spin"></div>
                <div class="absolute inset-0 w-12 h-12 rounded-full border-4 border-transparent ${isNeon ? 'border-r-neon-accent' : 'border-r-mysql-cyan'} animate-spin" style="animation-duration: 1.5s; animation-direction: reverse;"></div>
            </div>
            <span class="text-sm font-medium ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-gray-400')))}">${message}</span>
        `;
        return overlay;
    },

    /**
     * Create a dot pulse loader
     * @returns {HTMLElement}
     */
    dotPulse() {
        const theme = ThemeManager.getCurrentTheme();
        const isNeon = theme === 'neon';
        const container = document.createElement('div');
        container.className = 'flex items-center gap-1';
        container.innerHTML = `
            <div class="w-2 h-2 rounded-full ${isNeon ? 'bg-neon-accent' : 'bg-mysql-teal'} animate-bounce" style="animation-delay: 0ms;"></div>
            <div class="w-2 h-2 rounded-full ${isNeon ? 'bg-neon-accent' : 'bg-mysql-teal'} animate-bounce" style="animation-delay: 150ms;"></div>
            <div class="w-2 h-2 rounded-full ${isNeon ? 'bg-neon-accent' : 'bg-mysql-teal'} animate-bounce" style="animation-delay: 300ms;"></div>
        `;
        return container;
    },

    /**
     * Create inline text loading indicator
     * @param {string} text - Loading text
     * @returns {HTMLElement}
     */
    inlineText(text = 'Loading') {
        const theme = ThemeManager.getCurrentTheme();
        const isNeon = theme === 'neon';
        const span = document.createElement('span');
        span.className = `inline-flex items-center gap-2 ${isNeon ? 'text-neon-text/60' : 'text-gray-500'}`;
        span.innerHTML = `
            <span class="material-symbols-outlined text-sm animate-spin ${isNeon ? 'text-neon-accent' : ''}">progress_activity</span>
            <span class="animate-pulse">${text}</span>
        `;
        return span;
    },

    /**
     * Create a shimmer effect overlay
     * @returns {HTMLElement}
     */
    shimmer() {
        const shimmer = document.createElement('div');
        shimmer.className = 'absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer';
        return shimmer;
    }
};

// Add shimmer animation to CSS if not exists
const styleId = 'loading-states-styles';
if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        @keyframes shimmer {
            100% {
                transform: translateX(100%);
            }
        }
        .animate-shimmer {
            animation: shimmer 2s infinite;
        }
    `;
    document.head.appendChild(style);
}

export default LoadingStates;
