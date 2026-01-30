import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { Sidebar } from './Sidebar.js';

export function MainLayout(children) {
    const container = document.createElement('div');
    container.className = "flex flex-col h-full"; // Ensure it takes full height of parent

    container.appendChild(Header());

    const contentWrapper = document.createElement('div');
    contentWrapper.className = "flex-1 flex overflow-hidden p-6 gap-6";

    const main = document.createElement('main');
    main.className = "flex-1 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-2";

    // Append children
    if (Array.isArray(children)) {
        children.forEach(child => main.appendChild(child));
    } else if (children) {
        main.appendChild(children);
    }

    contentWrapper.appendChild(main);
    contentWrapper.appendChild(Sidebar());

    container.appendChild(contentWrapper);
    container.appendChild(Footer());

    return container;
}
