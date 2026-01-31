/**
 * ThemeManager - Handles dark/light theme persistence and toggling
 */
export const ThemeManager = {
    STORAGE_KEY: 'tactileSQL-theme',
    THEMES: {
        DARK: 'dark',
        LIGHT: 'light',
        OCEANIC: 'oceanic'
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
        const root = document.documentElement;
        if (root.classList.contains(this.THEMES.LIGHT)) return this.THEMES.LIGHT;
        if (root.classList.contains(this.THEMES.OCEANIC)) return this.THEMES.OCEANIC;
        return this.THEMES.DARK;
    },

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
     * Toggle between dark and light theme
     */
    toggle() {
        const current = this.getCurrentTheme();
        let newTheme;

        if (current === this.THEMES.DARK) newTheme = this.THEMES.LIGHT;
        else if (current === this.THEMES.LIGHT) newTheme = this.THEMES.OCEANIC;
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
