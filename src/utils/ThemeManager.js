/**
 * ThemeManager - Handles dark/light theme persistence and toggling
 * Provides helper methods for theme-aware styling
 */
export const ThemeManager = {
    STORAGE_KEY: 'tactileSQL-theme',
    THEMES: {
        DARK: 'dark',
        LIGHT: 'light',
        DAWN: 'dawn',
        OCEANIC: 'oceanic',
        EMBER: 'ember',
        AURORA: 'aurora',
        NEON: 'neon'
    },

    // Theme categories for grouping
    LIGHT_THEMES: ['light', 'dawn'],
    DARK_THEMES: ['dark', 'oceanic', 'ember', 'aurora', 'neon'],
    NORD_THEMES: ['oceanic', 'ember', 'aurora'],

    /**
     * Initialize theme on page load
     */
    init() {
        const savedTheme = this.getSavedTheme();
        this.applyTheme(savedTheme);
    },

    /**
     * Get saved theme from localStorage or default to dark
     */
    getSavedTheme() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved && Object.values(this.THEMES).includes(saved)) {
            return saved;
        }
        // Default to dark theme
        return this.THEMES.DARK;
    },

    /**
     * Get current active theme
     */
    getCurrentTheme() {
        const root = document.documentElement;
        if (root.classList.contains(this.THEMES.LIGHT)) return this.THEMES.LIGHT;
        if (root.classList.contains(this.THEMES.DAWN)) return this.THEMES.DAWN;
        if (root.classList.contains(this.THEMES.OCEANIC)) return this.THEMES.OCEANIC;
        if (root.classList.contains(this.THEMES.EMBER)) return this.THEMES.EMBER;
        if (root.classList.contains(this.THEMES.AURORA)) return this.THEMES.AURORA;
        if (root.classList.contains(this.THEMES.NEON)) return this.THEMES.NEON;
        return this.THEMES.DARK;
    },

    // =====================================================
    // THEME HELPER METHODS
    // =====================================================

    /**
     * Check if current theme is a light variant (light or dawn)
     * @returns {boolean}
     */
    isLight() {
        return this.LIGHT_THEMES.includes(this.getCurrentTheme());
    },

    /**
     * Check if current theme is a dark variant
     * @returns {boolean}
     */
    isDark() {
        return this.DARK_THEMES.includes(this.getCurrentTheme());
    },

    /**
     * Check if current theme is specifically 'light'
     * @returns {boolean}
     */
    isLightTheme() {
        return this.getCurrentTheme() === this.THEMES.LIGHT;
    },

    /**
     * Check if current theme is specifically 'dawn'
     * @returns {boolean}
     */
    isDawnTheme() {
        return this.getCurrentTheme() === this.THEMES.DAWN;
    },

    /**
     * Check if current theme is a Nord-style theme (oceanic, ember, aurora)
     * @returns {boolean}
     */
    isNordTheme() {
        return this.NORD_THEMES.includes(this.getCurrentTheme());
    },

    /**
     * Get theme flags object for easier destructuring
     * @returns {Object} Theme flags { isLight, isDark, isDawn, isOceanic, isEmber, isAurora }
     */
    getThemeFlags() {
        const theme = this.getCurrentTheme();
        return {
            theme,
            isLight: theme === this.THEMES.LIGHT,
            isDark: theme === this.THEMES.DARK,
            isDawn: theme === this.THEMES.DAWN,
            isOceanic: theme === this.THEMES.OCEANIC,
            isEmber: theme === this.THEMES.EMBER,
            isAurora: theme === this.THEMES.AURORA,
            isNeon: theme === this.THEMES.NEON,
            isLightVariant: this.LIGHT_THEMES.includes(theme),
            isDarkVariant: this.DARK_THEMES.includes(theme),
            isNordVariant: this.NORD_THEMES.includes(theme)
        };
    },

    /**
     * Get a class string based on theme
     * @param {Object} classes - Object with theme keys and class values
     * @param {string} classes.light - Classes for light theme
     * @param {string} classes.dark - Classes for dark theme
     * @param {string} classes.dawn - Classes for dawn theme
     * @param {string} classes.oceanic - Classes for oceanic theme
     * @param {string} classes.ember - Classes for ember theme
     * @param {string} classes.aurora - Classes for aurora theme
     * @param {string} classes.neon - Classes for neon theme
     * @returns {string} Class string for current theme
     */
    getClass(classes) {
        const theme = this.getCurrentTheme();
        return classes[theme] || classes.dark || '';
    },

    /**
     * Get classes with fallback chain: specific theme -> light/dark variant -> default
     * @param {Object} classes - Object with theme/variant keys
     * @param {string} classes.light - Classes for light themes
     * @param {string} classes.dark - Classes for dark themes
     * @param {string} classes.dawn - Classes for dawn theme (optional)
     * @param {string} classes.nord - Classes for nord themes (optional)
     * @returns {string} Class string
     */
    getClasses(classes) {
        const theme = this.getCurrentTheme();
        const { isLightVariant, isNordVariant } = this.getThemeFlags();

        // Check specific theme first
        if (classes[theme]) return classes[theme];

        // Check variant
        if (isNordVariant && classes.nord) return classes.nord;
        if (isLightVariant && classes.light) return classes.light;

        // Default to dark
        return classes.dark || '';
    },

    /**
     * Common background classes for different surfaces
     */
    backgrounds: {
        primary: () => ThemeManager.getClasses({
            light: 'bg-gray-50',
            dawn: 'bg-[#faf4ed]',
            dark: 'bg-[#0a0c10]',
            nord: 'bg-ocean-bg',
            neon: 'bg-neon-bg'
        }),
        secondary: () => ThemeManager.getClasses({
            light: 'bg-white',
            dawn: 'bg-[#fffaf3]',
            dark: 'bg-[#0f1115]',
            nord: 'bg-ocean-panel',
            neon: 'bg-neon-panel'
        }),
        surface: () => ThemeManager.getClasses({
            light: 'bg-white',
            dawn: 'bg-[#fffaf3]',
            dark: 'bg-[#13161b]',
            nord: 'bg-[#3B4252]',
            neon: 'bg-neon-panel/80'
        }),
        elevated: () => ThemeManager.getClasses({
            light: 'bg-white shadow-lg',
            dawn: 'bg-[#fffaf3] shadow-lg',
            dark: 'bg-[#1a1d23] shadow-2xl',
            nord: 'bg-ocean-panel shadow-2xl',
            neon: 'bg-neon-panel shadow-[0_0_15px_rgba(0,243,255,0.1)] border border-neon-border'
        }),
        input: () => ThemeManager.getClasses({
            light: 'bg-white border-gray-300',
            dawn: 'bg-[#fffaf3] border-[#f2e9e1]',
            dark: 'bg-[#0f1115] border-white/10',
            nord: 'bg-ocean-bg border-ocean-border/50',
            neon: 'bg-neon-bg border-neon-border focus:border-neon-text focus:shadow-[0_0_8px_rgba(0,243,255,0.3)]'
        })
    },

    /**
     * Common text classes
     */
    text: {
        primary: () => ThemeManager.getClasses({
            light: 'text-gray-900',
            dawn: 'text-[#575279]',
            dark: 'text-white',
            nord: 'text-ocean-text',
            neon: 'text-neon-text drop-shadow-[0_0_2px_rgba(0,243,255,0.5)]'
        }),
        secondary: () => ThemeManager.getClasses({
            light: 'text-gray-600',
            dawn: 'text-[#797593]',
            dark: 'text-gray-400',
            nord: 'text-ocean-text/70',
            neon: 'text-neon-text/70'
        }),
        muted: () => ThemeManager.getClasses({
            light: 'text-gray-400',
            dawn: 'text-[#9893a5]',
            dark: 'text-gray-500',
            nord: 'text-ocean-text/50',
            neon: 'text-neon-text/40'
        }),
        accent: () => ThemeManager.getClasses({
            light: 'text-mysql-teal',
            dawn: 'text-[#ea9d34]',
            dark: 'text-mysql-teal',
            nord: 'text-ocean-frost',
            neon: 'text-neon-accent drop-shadow-[0_0_5px_rgba(255,0,153,0.6)]'
        })
    },

    /**
     * Common border classes
     */
    borders: {
        default: () => ThemeManager.getClasses({
            light: 'border-gray-200',
            dawn: 'border-[#f2e9e1]',
            dark: 'border-white/5',
            nord: 'border-ocean-border',
            neon: 'border-neon-border'
        }),
        subtle: () => ThemeManager.getClasses({
            light: 'border-gray-100',
            dawn: 'border-[#f2e9e1]/50',
            dark: 'border-white/5',
            nord: 'border-ocean-border/30',
            neon: 'border-neon-border/50'
        }),
        accent: () => ThemeManager.getClasses({
            light: 'border-mysql-teal/30',
            dawn: 'border-[#ea9d34]/30',
            dark: 'border-mysql-teal/30',
            nord: 'border-ocean-frost/30',
            neon: 'border-neon-text/50 shadow-[0_0_5px_rgba(0,243,255,0.2)]'
        })
    },

    /**
     * Button style utilities
     */
    buttons: {
        primary: () => ThemeManager.getClasses({
            light: 'bg-mysql-teal text-white hover:bg-mysql-teal/90',
            dawn: 'bg-[#ea9d34] text-white hover:bg-[#ea9d34]/90',
            dark: 'bg-mysql-teal text-white hover:bg-mysql-teal/90',
            nord: 'bg-ocean-frost text-ocean-bg hover:bg-ocean-frost/90',
            neon: 'bg-neon-accent text-white hover:bg-neon-accent/90 shadow-[0_0_10px_rgba(255,0,153,0.4)] hover:shadow-[0_0_15px_rgba(255,0,153,0.6)] transition-all'
        }),
        secondary: () => ThemeManager.getClasses({
            light: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
            dawn: 'bg-[#f2e9e1] text-[#575279] hover:bg-[#f2e9e1]/80',
            dark: 'bg-white/5 text-gray-300 hover:bg-white/10',
            nord: 'bg-ocean-border/30 text-ocean-text hover:bg-ocean-border/50',
            neon: 'bg-neon-panel border border-neon-border text-neon-text hover:bg-neon-border/50 hover:shadow-[0_0_8px_rgba(0,243,255,0.2)]'
        }),
        ghost: () => ThemeManager.getClasses({
            light: 'text-gray-600 hover:bg-gray-100',
            dawn: 'text-[#797593] hover:bg-[#f2e9e1]',
            dark: 'text-gray-400 hover:bg-white/5',
            nord: 'text-ocean-text/70 hover:bg-ocean-border/30',
            neon: 'text-neon-text/70 hover:text-neon-text hover:bg-neon-border/30'
        }),
        danger: () => ThemeManager.getClasses({
            light: 'bg-red-500 text-white hover:bg-red-600',
            dawn: 'bg-[#b4637a] text-white hover:bg-[#b4637a]/90',
            dark: 'bg-red-500/80 text-white hover:bg-red-500',
            nord: 'bg-[#BF616A] text-white hover:bg-[#BF616A]/90',
            neon: 'bg-red-500 text-white hover:bg-red-600 shadow-[0_0_10px_rgba(239,68,68,0.4)]'
        })
    },

    /**
     * Card/Panel style utilities
     */
    cards: {
        default: () => ThemeManager.getClasses({
            light: 'bg-white border border-gray-200 rounded-lg shadow-sm',
            dawn: 'bg-[#fffaf3] border border-[#f2e9e1] rounded-lg shadow-sm',
            dark: 'bg-[#13161b] border border-white/5 rounded-lg',
            nord: 'bg-ocean-panel border border-ocean-border rounded-lg',
            neon: 'bg-neon-panel border border-neon-border rounded-lg'
        }),
        elevated: () => ThemeManager.getClasses({
            light: 'bg-white rounded-lg shadow-lg',
            dawn: 'bg-[#fffaf3] rounded-lg shadow-lg',
            dark: 'bg-[#1a1d23] rounded-lg shadow-2xl',
            nord: 'bg-ocean-panel rounded-lg shadow-2xl',
            neon: 'bg-neon-panel border border-neon-border/50 rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)]'
        }),
        interactive: () => ThemeManager.getClasses({
            light: 'bg-white border border-gray-200 rounded-lg hover:border-mysql-teal/50 transition-colors',
            dawn: 'bg-[#fffaf3] border border-[#f2e9e1] rounded-lg hover:border-[#ea9d34]/50 transition-colors',
            dark: 'bg-[#13161b] border border-white/5 rounded-lg hover:border-mysql-teal/30 transition-colors',
            nord: 'bg-ocean-panel border border-ocean-border rounded-lg hover:border-ocean-frost/50 transition-colors',
            neon: 'bg-neon-panel border border-neon-border rounded-lg hover:border-neon-text/50 hover:shadow-[0_0_10px_rgba(0,243,255,0.1)] transition-all'
        })
    },

    /**
     * Form input utilities
     */
    inputs: {
        text: () => ThemeManager.getClasses({
            light: 'bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-mysql-teal focus:ring-1 focus:ring-mysql-teal',
            dawn: 'bg-[#fffaf3] border border-[#f2e9e1] text-[#575279] placeholder-[#9893a5] focus:border-[#ea9d34] focus:ring-1 focus:ring-[#ea9d34]',
            dark: 'bg-[#0f1115] border border-white/10 text-white placeholder-gray-500 focus:border-mysql-teal focus:ring-1 focus:ring-mysql-teal',
            nord: 'bg-ocean-bg border border-ocean-border/50 text-ocean-text placeholder-ocean-text/50 focus:border-ocean-frost focus:ring-1 focus:ring-ocean-frost',
            neon: 'bg-neon-bg border border-neon-border text-neon-text placeholder-neon-text/30 focus:border-neon-text focus:ring-1 focus:ring-neon-text focus:shadow-[0_0_8px_rgba(0,243,255,0.3)]'
        }),
        select: () => ThemeManager.getClasses({
            light: 'bg-white border border-gray-300 text-gray-900',
            dawn: 'bg-[#fffaf3] border border-[#f2e9e1] text-[#575279]',
            dark: 'bg-[#0f1115] border border-white/10 text-white',
            nord: 'bg-ocean-bg border border-ocean-border/50 text-ocean-text',
            neon: 'bg-neon-bg border border-neon-border text-neon-text'
        }),
        checkbox: () => ThemeManager.getClasses({
            light: 'text-mysql-teal bg-white border-gray-300 focus:ring-mysql-teal',
            dawn: 'text-[#ea9d34] bg-[#fffaf3] border-[#f2e9e1] focus:ring-[#ea9d34]',
            dark: 'text-mysql-teal bg-[#0f1115] border-white/20 focus:ring-mysql-teal',
            nord: 'text-ocean-frost bg-ocean-bg border-ocean-border focus:ring-ocean-frost',
            neon: 'text-neon-text bg-neon-bg border-neon-border focus:ring-neon-text focus:ring-offset-0'
        })
    },

    /**
     * Badge/Tag utilities
     */
    badges: {
        default: () => ThemeManager.getClasses({
            light: 'bg-gray-100 text-gray-700',
            dawn: 'bg-[#f2e9e1] text-[#575279]',
            dark: 'bg-white/10 text-gray-300',
            nord: 'bg-ocean-border/50 text-ocean-text',
            neon: 'bg-neon-border/50 text-neon-text border border-neon-border'
        }),
        success: () => ThemeManager.getClasses({
            light: 'bg-green-100 text-green-700',
            dawn: 'bg-[#d7f5e3] text-[#286f48]',
            dark: 'bg-green-500/20 text-green-400',
            nord: 'bg-[#A3BE8C]/20 text-[#A3BE8C]',
            neon: 'bg-green-500/20 text-green-400 border border-green-500/30'
        }),
        warning: () => ThemeManager.getClasses({
            light: 'bg-yellow-100 text-yellow-700',
            dawn: 'bg-[#f9e2af] text-[#df8e1d]',
            dark: 'bg-yellow-500/20 text-yellow-400',
            nord: 'bg-[#EBCB8B]/20 text-[#EBCB8B]',
            neon: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
        }),
        error: () => ThemeManager.getClasses({
            light: 'bg-red-100 text-red-700',
            dawn: 'bg-[#f8d7da] text-[#b4637a]',
            dark: 'bg-red-500/20 text-red-400',
            nord: 'bg-[#BF616A]/20 text-[#BF616A]',
            neon: 'bg-red-500/20 text-red-400 border border-red-500/30'
        }),
        info: () => ThemeManager.getClasses({
            light: 'bg-blue-100 text-blue-700',
            dawn: 'bg-[#dbe5f1] text-[#4a7eb8]',
            dark: 'bg-blue-500/20 text-blue-400',
            nord: 'bg-[#81A1C1]/20 text-[#81A1C1]',
            neon: 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
        })
    },

    /**
     * Table utilities
     */
    tables: {
        header: () => ThemeManager.getClasses({
            light: 'bg-gray-50 text-gray-700 border-b border-gray-200',
            dawn: 'bg-[#faf4ed] text-[#575279] border-b border-[#f2e9e1]',
            dark: 'bg-[#0f1115] text-gray-400 border-b border-white/5',
            nord: 'bg-ocean-bg text-ocean-text/70 border-b border-ocean-border',
            neon: 'bg-neon-bg text-neon-text border-b border-neon-border'
        }),
        row: () => ThemeManager.getClasses({
            light: 'border-b border-gray-100 hover:bg-gray-50',
            dawn: 'border-b border-[#f2e9e1]/50 hover:bg-[#faf4ed]',
            dark: 'border-b border-white/5 hover:bg-white/5',
            nord: 'border-b border-ocean-border/30 hover:bg-ocean-border/20',
            neon: 'border-b border-neon-border/30 hover:bg-neon-text/5'
        }),
        cell: () => ThemeManager.getClasses({
            light: 'text-gray-900',
            dawn: 'text-[#575279]',
            dark: 'text-gray-300',
            nord: 'text-ocean-text',
            neon: 'text-neon-text/90'
        })
    },

    /**
     * Scrollbar utilities (CSS custom properties)
     */
    scrollbar: () => ThemeManager.getClasses({
        light: 'scrollbar-thumb-gray-300 scrollbar-track-gray-100',
        dawn: 'scrollbar-thumb-[#dcd5cd] scrollbar-track-[#f2e9e1]',
        dark: 'scrollbar-thumb-gray-700 scrollbar-track-transparent',
        nord: 'scrollbar-thumb-ocean-border scrollbar-track-transparent'
    }),

    /**
     * Tooltip utilities
     */
    tooltip: () => ThemeManager.getClasses({
        light: 'bg-gray-900 text-white',
        dawn: 'bg-[#575279] text-white',
        dark: 'bg-gray-800 text-white',
        nord: 'bg-ocean-panel text-ocean-text border border-ocean-border'
    }),

    /**
     * Apply theme to document
     */
    applyTheme(theme) {
        const root = document.documentElement;

        // Remove all theme classes
        Object.values(this.THEMES).forEach(t => root.classList.remove(t));

        // Add current theme class
        root.classList.add(theme);

        localStorage.setItem(this.STORAGE_KEY, theme);

        // Dispatch custom event for components that need to react
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
    },

    /**
     * Toggle between themes
     */
    toggle() {
        const current = this.getCurrentTheme();
        let newTheme;

        if (current === this.THEMES.DARK) newTheme = this.THEMES.LIGHT;
        else if (current === this.THEMES.LIGHT) newTheme = this.THEMES.DAWN;
        else if (current === this.THEMES.DAWN) newTheme = this.THEMES.OCEANIC;
        else if (current === this.THEMES.OCEANIC) newTheme = this.THEMES.EMBER;
        else if (current === this.THEMES.EMBER) newTheme = this.THEMES.AURORA;
        else if (current === this.THEMES.AURORA) newTheme = this.THEMES.NEON;
        else newTheme = this.THEMES.DARK;

        this.applyTheme(newTheme);
        return newTheme;
    },

    /**
     * Set specific theme
     */
    setTheme(theme) {
        if (Object.values(this.THEMES).includes(theme)) {
            this.applyTheme(theme);
        }
    }
};
