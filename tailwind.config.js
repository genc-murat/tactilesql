/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                "mysql-cyan": "#00f3ff",
                "mysql-purple": "#a855f7",
                "panel-dark": "#16191e",
                "base-dark": "#0a0c10",
                "deep-dark": "#0b0d10",
                "neon-cyan": "#00f2ff",
                "mysql-teal": "#00758f",
                "workspace-bg": "#0b0d11",
                "workspace-dark": "#0b0d11",
                "panel-bg": "#15181d",
                "surface-dark": "#0f1115",
                "sql-keyword": "#ff79c6",
                "sql-function": "#8be9fd",
                "sql-string": "#f1fa8c",
                "sql-ident": "#50fa7b",
                "sql-comment": "#6272a4",
                // Oceanic (Nord-like) Palette
                "ocean-frost": "#88C0D0",
                "ocean-mint": "#A3BE8C",
                "ocean-bg": "#2E3440",
                "ocean-panel": "#3B4252",
                "ocean-border": "#4C566A",
                "ocean-text": "#D8DEE9",
            },
            fontFamily: {
                "mono": ["JetBrains Mono", "monospace"],
                "sans": ["Inter", "sans-serif"]
            }
        },
    },
    plugins: [
        require('@tailwindcss/forms'),
        require('@tailwindcss/container-queries')
    ],
}
