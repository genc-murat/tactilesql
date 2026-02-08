import { defineConfig } from 'vite'


// https://vitejs.dev/config/
export default defineConfig({
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
    },
    build: {
        rollupOptions: {
            input: {
                main: 'index.html',
                splashscreen: 'splashscreen.html',
            },
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('cytoscape')) {
                            return 'vendor-cytoscape';
                        }
                        return 'vendor';
                    }
                }
            }
        }
    }
})
