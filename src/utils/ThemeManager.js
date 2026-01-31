/**
 * ThemeManager - Handles dark/light theme persistence and toggling
 */
export const ThemeManager = {
    STORAGE_KEY: 'tactileSQL-theme',
    THEMES: {
        DARK: 'dark',
        LIGHT: 'light'
    },

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
        return document.documentElement.classList.contains('light')
            ? this.THEMES.LIGHT
            : this.THEMES.DARK;
    },

    /**
     * Apply theme to document
     */
    applyTheme(theme) {
        const root = document.documentElement;

        if (theme === this.THEMES.LIGHT) {
            root.classList.remove('dark');
            root.classList.add('light');
        } else {
            root.classList.remove('light');
            root.classList.add('dark');
        }

        localStorage.setItem(this.STORAGE_KEY, theme);

        // Dispatch custom event for components that need to react
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
    },

    /**
     * Toggle between dark and light theme
     */
    toggle() {
        const current = this.getCurrentTheme();
        const newTheme = current === this.THEMES.DARK
            ? this.THEMES.LIGHT
            : this.THEMES.DARK;
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
