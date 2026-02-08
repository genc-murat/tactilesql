/**
 * Toast Notification System for TactileSQL
 * Provides non-intrusive notifications for user feedback
 */

import { ThemeManager } from './ThemeManager.js';

// Toast container ID
const TOAST_CONTAINER_ID = 'tactile-toast-container';

// Toast types with their configurations
const TOAST_TYPES = {
    success: {
        icon: 'check_circle',
        bgClass: 'bg-green-500/10 border-green-500/30',
        iconClass: 'text-green-500',
        titleClass: 'text-green-400'
    },
    error: {
        icon: 'error',
        bgClass: 'bg-red-500/10 border-red-500/30',
        iconClass: 'text-red-500',
        titleClass: 'text-red-400'
    },
    warning: {
        icon: 'warning',
        bgClass: 'bg-yellow-500/10 border-yellow-500/30',
        iconClass: 'text-yellow-500',
        titleClass: 'text-yellow-400'
    },
    info: {
        icon: 'info',
        bgClass: 'bg-blue-500/10 border-blue-500/30',
        iconClass: 'text-blue-500',
        titleClass: 'text-blue-400'
    }
};

// Light theme overrides
const TOAST_TYPES_LIGHT = {
    success: {
        bgClass: 'bg-green-50 border-green-200',
        iconClass: 'text-green-600',
        titleClass: 'text-green-700'
    },
    error: {
        bgClass: 'bg-red-50 border-red-200',
        iconClass: 'text-red-600',
        titleClass: 'text-red-700'
    },
    warning: {
        bgClass: 'bg-yellow-50 border-yellow-200',
        iconClass: 'text-yellow-600',
        titleClass: 'text-yellow-700'
    },
    info: {
        bgClass: 'bg-blue-50 border-blue-200',
        iconClass: 'text-blue-600',
        titleClass: 'text-blue-700'
    }
};

// Dawn theme overrides
const TOAST_TYPES_DAWN = {
    success: {
        bgClass: 'bg-[#9ccfd8]/10 border-[#9ccfd8]/30',
        iconClass: 'text-[#56949f]',
        titleClass: 'text-[#56949f]'
    },
    error: {
        bgClass: 'bg-[#eb6f92]/10 border-[#eb6f92]/30',
        iconClass: 'text-[#eb6f92]',
        titleClass: 'text-[#eb6f92]'
    },
    warning: {
        bgClass: 'bg-[#f6c177]/10 border-[#f6c177]/30',
        iconClass: 'text-[#ea9d34]',
        titleClass: 'text-[#ea9d34]'
    },
    info: {
        bgClass: 'bg-[#3e8fb0]/10 border-[#3e8fb0]/30',
        iconClass: 'text-[#3e8fb0]',
        titleClass: 'text-[#3e8fb0]'
    }
};

// Neon theme overrides
const TOAST_TYPES_NEON = {
    success: {
        bgClass: 'bg-neon-accent/10 border-neon-accent/30',
        iconClass: 'text-neon-accent',
        titleClass: 'text-neon-accent'
    },
    error: {
        bgClass: 'bg-neon-pink/10 border-neon-pink/30',
        iconClass: 'text-neon-pink',
        titleClass: 'text-neon-pink'
    },
    warning: {
        bgClass: 'bg-neon-accent/10 border-neon-accent/30',
        iconClass: 'text-neon-accent',
        titleClass: 'text-neon-accent'
    },
    info: {
        bgClass: 'bg-neon-cyan/10 border-neon-cyan/30',
        iconClass: 'text-neon-cyan',
        titleClass: 'text-neon-cyan'
    }
};

/**
 * Get or create toast container
 * @returns {HTMLElement} Toast container element
 */
const getContainer = () => {
    let container = document.getElementById(TOAST_CONTAINER_ID);

    if (!container) {
        container = document.createElement('div');
        container.id = TOAST_CONTAINER_ID;
        container.className = 'fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none';
        container.style.maxWidth = '400px';
        document.body.appendChild(container);
    }

    return container;
};

/**
 * Get toast type config based on current theme
 * @param {string} type - Toast type
 * @returns {Object} Toast type configuration
 */
const getTypeConfig = (type) => {
    const theme = ThemeManager.getCurrentTheme();
    const baseConfig = TOAST_TYPES[type] || TOAST_TYPES.info;

    if (theme === 'light') {
        return { ...baseConfig, ...TOAST_TYPES_LIGHT[type] };
    } else if (theme === 'dawn') {
        return { ...baseConfig, ...TOAST_TYPES_DAWN[type] };
    } else if (theme === 'neon') {
        return { ...baseConfig, ...TOAST_TYPES_NEON[type] };
    }

    return baseConfig;
};

/**
 * Show a toast notification
 * @param {string} message - Main message to display
 * @param {string} type - Toast type: 'success' | 'error' | 'warning' | 'info'
 * @param {Object} options - Additional options
 * @param {string} options.title - Optional title
 * @param {number} options.duration - Duration in ms (default: 4000, 0 for persistent)
 * @param {boolean} options.closable - Show close button (default: true)
 * @param {Function} options.onClick - Click handler
 * @param {Function} options.onClose - Close callback
 * @returns {Object} Toast instance with dismiss method
 */
export const showToast = (message, type = 'info', options = {}) => {
    const {
        title = null,
        duration = 4000,
        closable = true,
        onClick = null,
        onClose = null
    } = options;

    const container = getContainer();
    const config = getTypeConfig(type);
    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `
        pointer-events-auto flex items-start gap-3 p-4 rounded-lg border shadow-lg
        backdrop-blur-sm transform translate-x-full opacity-0 transition-all duration-300
        ${config.bgClass}
        ${isLight ? 'shadow-gray-200' : (isDawn ? 'shadow-[#dfdad9]/20' : (theme === 'neon' ? 'shadow-neon-accent/10' : 'shadow-black/40'))}
        ${onClick ? 'cursor-pointer hover:scale-[1.02]' : ''}
    `.trim().replace(/\s+/g, ' ');

    // Build toast content
    const titleHtml = title ? `
        <div class="font-semibold text-sm ${config.titleClass}">${title}</div>
    ` : '';

    const closeButtonHtml = closable ? `
        <button class="toast-close flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors ${isLight ? 'text-gray-400 hover:text-gray-600' : (isDawn ? 'text-[#9893a5] hover:text-[#575279]' : (theme === 'neon' ? 'text-neon-text/40 hover:text-neon-accent' : 'text-gray-500 hover:text-gray-300'))}">
            <span class="material-symbols-outlined text-base">close</span>
        </button>
    ` : '';

    toast.innerHTML = `
        <span class="material-symbols-outlined text-xl ${config.iconClass} flex-shrink-0 mt-0.5">${config.icon}</span>
        <div class="flex-1 min-w-0">
            ${titleHtml}
            <div class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#575279]' : (theme === 'neon' ? 'text-neon-text' : 'text-gray-300'))} ${title ? 'mt-1' : ''}">${message}</div>
        </div>
        ${closeButtonHtml}
    `;

    // Add to container
    container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
    });

    // Dismiss function
    const dismiss = () => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => {
            toast.remove();
            onClose?.();
        }, 300);
    };

    // Event handlers
    if (closable) {
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            dismiss();
        });
    }

    if (onClick) {
        toast.addEventListener('click', (e) => {
            if (!e.target.closest('.toast-close')) {
                onClick();
                dismiss();
            }
        });
    }

    // Auto dismiss
    let timeoutId = null;
    if (duration > 0) {
        timeoutId = setTimeout(dismiss, duration);

        // Pause on hover
        toast.addEventListener('mouseenter', () => {
            if (timeoutId) clearTimeout(timeoutId);
        });

        toast.addEventListener('mouseleave', () => {
            timeoutId = setTimeout(dismiss, duration / 2);
        });
    }

    return { dismiss };
};

/**
 * Shorthand for success toast
 * @param {string} message - Message to display
 * @param {Object} options - Additional options
 */
export const toastSuccess = (message, options = {}) => showToast(message, 'success', options);

/**
 * Shorthand for error toast
 * @param {string} message - Message to display
 * @param {Object} options - Additional options
 */
export const toastError = (message, options = {}) => showToast(message, 'error', options);

/**
 * Shorthand for warning toast
 * @param {string} message - Message to display
 * @param {Object} options - Additional options
 */
export const toastWarning = (message, options = {}) => showToast(message, 'warning', options);

/**
 * Shorthand for info toast
 * @param {string} message - Message to display
 * @param {Object} options - Additional options
 */
export const toastInfo = (message, options = {}) => showToast(message, 'info', options);

/**
 * Clear all toasts
 */
export const clearAllToasts = () => {
    const container = document.getElementById(TOAST_CONTAINER_ID);
    if (container) {
        container.innerHTML = '';
    }
};

/**
 * Show a promise-based toast (loading -> success/error)
 * @param {Promise} promise - Promise to track
 * @param {Object} messages - Messages for each state
 * @param {string} messages.loading - Loading message
 * @param {string} messages.success - Success message
 * @param {string|Function} messages.error - Error message or function that receives error
 * @returns {Promise} The original promise
 */
export const toastPromise = async (promise, messages = {}) => {
    const {
        loading = 'Processing...',
        success = 'Success!',
        error = 'An error occurred'
    } = messages;

    // Show loading toast
    const loadingToast = showToast(loading, 'info', { duration: 0, closable: false });

    try {
        const result = await promise;
        loadingToast.dismiss();
        toastSuccess(success);
        return result;
    } catch (err) {
        loadingToast.dismiss();
        const errorMessage = typeof error === 'function' ? error(err) : error;
        toastError(errorMessage);
        throw err;
    }
};

// Export default object for convenience
export default {
    show: showToast,
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    info: toastInfo,
    promise: toastPromise,
    clear: clearAllToasts
};
