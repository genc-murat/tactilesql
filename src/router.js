export class Router {
    constructor(routes, rootElement) {
        this.routes = routes;
        this.rootElement = rootElement;
        this.currentPath = null;

        window.addEventListener('hashchange', () => this.handleRoute());
        window.addEventListener('load', () => this.handleRoute());
    }

    async handleRoute() {
        let hash = window.location.hash.slice(1);

        if (!hash || hash === '/') {
            window.location.hash = '/workbench';
            hash = '/workbench';
        }

        // Split path and query parameters
        const [path] = hash.split('?');
        this.currentPath = path;

        const route = this.routes[path] || this.routes['/'];

        if (route) {
            // Use a transition ID to prevent race conditions during async component loading
            const transitionId = Date.now() + Math.random();
            this.lastTransitionId = transitionId;

            if (route.component) {
                // If it's a function that returns an element or string
                const content = await route.component();

                // If a new route transition has started since this one, ignore this result
                if (this.lastTransitionId !== transitionId) return;

                this.rootElement.innerHTML = '';
                if (typeof content === 'string') {
                    this.rootElement.innerHTML = content;
                } else if (content instanceof Node) {
                    this.rootElement.appendChild(content);
                }
            }
        }
    }

    navigate(path) {
        window.location.hash = path;
    }
}
