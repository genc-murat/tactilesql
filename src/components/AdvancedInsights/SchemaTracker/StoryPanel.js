import { ThemeManager } from '../../../utils/ThemeManager.js';

export function StoryPanel({ story, isLoading }) {
    const isLight = ThemeManager.getCurrentTheme() === 'light';
    const container = document.createElement('div');
    container.className = `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-white' : 'bg-[#0f1115]'} animate-fade-in`;

    if (isLoading) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full opacity-60">
                <span class="material-symbols-outlined text-4xl mb-4 animate-spin text-blue-500">auto_stories</span>
                <p class="text-sm font-medium animate-pulse">Writing your chronicle...</p>
            </div>
        `;
        return container;
    }

    if (!story) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full opacity-40">
                <span class="material-symbols-outlined text-4xl mb-4">menu_book</span>
                <p class="text-xs">Select a snapshot to view its story.</p>
            </div>
        `;
        return container;
    }

    // Header
    const header = document.createElement('div');
    header.className = `p-6 pb-4 border-b ${isLight ? 'border-gray-100' : 'border-white/5'}`;
    header.innerHTML = `
        <div class="flex items-center gap-3 mb-2">
            <div class="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
                <span class="material-symbols-outlined text-xl">auto_stories</span>
            </div>
            <div>
                <h2 class="text-lg font-bold ${isLight ? 'text-gray-800' : 'text-gray-100'}">${story.title}</h2>
                <p class="text-xs opacity-60">Generated narrative based on schema changes and row count trends.</p>
            </div>
        </div>
    `;
    container.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6';

    story.sections.forEach(section => {
        const severity = section.severity || 0;
        const sectionEl = document.createElement('article');

        let severityClasses = '';
        let iconColor = 'text-gray-500';
        let sectionIcon = section.icon;

        if (isLight) {
            if (severity === 3) {
                severityClasses = 'border-red-200 bg-red-50';
                iconColor = 'text-red-500';
            } else if (severity === 2) {
                severityClasses = 'border-amber-200 bg-amber-50';
                iconColor = 'text-amber-500';
            } else if (severity === 1) {
                severityClasses = 'border-blue-200 bg-blue-50';
                iconColor = 'text-blue-500';
            } else {
                severityClasses = 'border-gray-100 bg-gray-50';
            }
        } else {
            if (severity === 3) {
                severityClasses = 'border-red-500/30 bg-red-500/5';
                iconColor = 'text-red-400';
            } else if (severity === 2) {
                severityClasses = 'border-amber-500/30 bg-amber-500/5';
                iconColor = 'text-amber-400';
            } else if (severity === 1) {
                severityClasses = 'border-blue-500/30 bg-blue-500/5';
                iconColor = 'text-blue-400';
            } else {
                severityClasses = 'border-white/5 bg-white/5';
            }
        }

        sectionEl.className = `p-4 rounded-xl border ${severityClasses} transition-all hover:translate-x-1 duration-200`;

        let listHtml = '';
        if (section.changes && section.changes.length > 0) {
            listHtml = `
                <ul class="mt-3 space-y-1">
                    ${section.changes.map(change => {
                // Handle [severity] prefix if present in the string
                let label = change;
                let badge = '';
                if (change.startsWith('[3]')) { label = change.substring(3); badge = '<span class="px-1.5 py-0.5 rounded bg-red-500/20 text-[8px] font-bold uppercase tracking-tighter">Critical</span>'; }
                else if (change.startsWith('[2]')) { label = change.substring(3); badge = '<span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-[8px] font-bold uppercase tracking-tighter">High</span>'; }

                return `
                        <li class="text-xs opacity-70 flex items-start gap-2">
                            <span class="w-1 h-1 rounded-full bg-current mt-1.5 opacity-50 shrink-0"></span>
                            <span class="flex-1">${label}</span>
                            ${badge}
                        </li>
                    `}).join('')}
                </ul>
            `;
        }

        sectionEl.innerHTML = `
            <div class="flex items-start gap-3">
                <span class="material-symbols-outlined ${iconColor} mt-0.5">${sectionIcon}</span>
                <div class="flex-1 min-w-0">
                    <h3 class="font-bold text-sm ${isLight ? 'text-gray-800' : 'text-gray-200'} flex items-center gap-2">
                        ${section.title}
                    </h3>
                    <p class="text-xs leading-relaxed opacity-80 mt-1">${section.content}</p>
                    ${listHtml}
                </div>
            </div>
        `;
        content.appendChild(sectionEl);
    });

    container.appendChild(content);

    return container;
}
