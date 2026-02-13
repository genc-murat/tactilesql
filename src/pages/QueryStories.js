import { QueryStoryAPI } from '../api/queryStory.js';
import { ThemeManager } from '../utils/ThemeManager.js';
import { escapeHtml } from '../utils/helpers.js';
import { Dialog } from '../components/UI/Dialog.js';

export function QueryStories() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');

    const getClasses = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isNeon = t === 'neon';
        const isNord = t === 'oceanic' || t === 'ember' || t === 'aurora';

        return {
            container: `flex-1 flex flex-col h-full overflow-hidden ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isNord ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-[#0a0c10]')))} transition-colors duration-300`,
            header: `px-6 py-4 border-b ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNord ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/30' : 'bg-[#13161b] border-white/10')))}`,
            content: `flex-1 overflow-y-auto custom-scrollbar p-6`,
            card: `rounded-xl border shadow-sm ${isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isNord ? 'bg-ocean-panel border-ocean-border/50' : (isNeon ? 'bg-neon-panel border-neon-border/40' : 'bg-[#13161b] border-white/10')))}`,
            text: {
                primary: isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : (isNeon ? 'text-neon-text' : 'text-white')),
                secondary: isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')),
                subtle: isLight ? 'text-gray-400' : (isDawn ? 'text-[#9893a5]' : (isNeon ? 'text-neon-text/40' : 'text-gray-500')),
            },
            badge: (isFavorite) => `px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${isFavorite ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' : 'bg-gray-500/10 text-gray-500 border border-gray-500/20'}`
        };
    };

    let classes = getClasses(theme);
    container.className = classes.container;

    let state = {
        stories: [],
        isLoading: true,
        error: null,
        searchQuery: '',
    };

    const loadStories = async () => {
        state.isLoading = true;
        render();
        try {
            state.stories = await QueryStoryAPI.getAllStories(100);
            state.error = null;
        } catch (err) {
            state.error = `Failed to load stories: ${err}`;
        } finally {
            state.isLoading = false;
            render();
        }
    };

    const toggleFavorite = async (hash) => {
        try {
            await QueryStoryAPI.toggleFavorite(hash);
            const story = state.stories.find(s => s.query_hash === hash);
            if (story) story.is_favorite = !story.is_favorite;
            render();
        } catch (err) {
            Dialog.alert('Failed to toggle favorite: ' + err);
        }
    };

    const deleteStory = async (hash) => {
        const confirmed = await Dialog.confirm('Are you sure you want to delete this story?', 'Delete Story');
        if (!confirmed) return;

        try {
            await QueryStoryAPI.deleteStory(hash);
            state.stories = state.stories.filter(s => s.query_hash !== hash);
            render();
        } catch (err) {
            Dialog.alert('Failed to delete story: ' + err);
        }
    };

    const render = () => {
        classes = getClasses(theme);
        container.className = classes.container;

        const filteredStories = state.stories.filter(s => {
            const q = state.searchQuery.toLowerCase();
            return s.query_text.toLowerCase().includes(q) || 
                   (s.context && s.context.toLowerCase().includes(q)) ||
                   (s.author && s.author.toLowerCase().includes(q)) ||
                   (s.tags && s.tags.some(t => t.toLowerCase().includes(q)));
        });

        container.innerHTML = `
            <div class="${classes.header}">
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <div class="text-sm font-black tracking-[0.2em] uppercase ${classes.text.primary}">Query Stories</div>
                        <div class="text-[11px] ${classes.text.secondary} mt-1">Shared query knowledge, performance history, and discussions.</div>
                    </div>
                    <button id="btn-refresh" class="px-4 py-2 rounded-lg bg-mysql-teal text-black text-[11px] font-bold uppercase tracking-widest hover:brightness-110 transition-all">
                        Refresh
                    </button>
                </div>
                <div class="relative">
                    <input type="text" id="story-search" placeholder="Search stories by query, context, author, or tags..." 
                        class="w-full ${theme === 'light' ? 'bg-gray-100' : 'bg-white/5'} border ${theme === 'light' ? 'border-gray-200' : 'border-white/10'} rounded-lg px-10 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-mysql-teal transition-all"
                        value="${escapeHtml(state.searchQuery)}">
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg ${classes.text.subtle}">search</span>
                </div>
            </div>

            <div class="${classes.content}">
                ${state.isLoading ? `
                    <div class="flex flex-col items-center justify-center h-64 opacity-50">
                        <span class="material-symbols-outlined text-4xl animate-spin">progress_activity</span>
                        <p class="mt-4 text-sm font-bold uppercase tracking-widest">Loading Stories...</p>
                    </div>
                ` : ''}

                ${state.error ? `
                    <div class="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs mb-6">
                        ${escapeHtml(state.error)}
                    </div>
                ` : ''}

                ${!state.isLoading && filteredStories.length === 0 ? `
                    <div class="flex flex-col items-center justify-center h-64 opacity-30">
                        <span class="material-symbols-outlined text-6xl">history_edu</span>
                        <p class="mt-4 text-sm font-bold uppercase tracking-widest">No query stories found</p>
                    </div>
                ` : ''}

                <div class="grid grid-cols-1 gap-6">
                    ${filteredStories.map(story => `
                        <div class="${classes.card} p-5 flex flex-col gap-4">
                            <div class="flex items-start justify-between">
                                <div class="flex items-center gap-3">
                                    <div class="w-10 h-10 rounded-full bg-mysql-teal/10 flex items-center justify-center text-mysql-teal">
                                        <span class="material-symbols-outlined">history_edu</span>
                                    </div>
                                    <div>
                                        <div class="flex items-center gap-2">
                                            <span class="text-sm font-bold ${classes.text.primary}">${escapeHtml(story.author || 'Anonymous')}</span>
                                            <span class="${classes.badge(story.is_favorite)} cursor-pointer btn-favorite" data-hash="${story.query_hash}">
                                                ${story.is_favorite ? '★ Favorite' : '☆ Favorite'}
                                            </span>
                                        </div>
                                        <div class="text-[10px] ${classes.text.subtle} mt-1">
                                            ${new Date(story.created_at).toLocaleString()} · ${story.versions?.length || 1} versions
                                        </div>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button class="p-2 rounded-lg hover:bg-white/5 ${classes.text.subtle} hover:text-white transition-all btn-view-story" data-hash="${story.query_hash}" title="Open Story">
                                        <span class="material-symbols-outlined">open_in_new</span>
                                    </button>
                                    <button class="p-2 rounded-lg hover:bg-red-500/10 ${classes.text.subtle} hover:text-red-500 transition-all btn-delete-story" data-hash="${story.query_hash}" title="Delete Story">
                                        <span class="material-symbols-outlined">delete</span>
                                    </button>
                                </div>
                            </div>

                            <div class="p-3 rounded-lg ${theme === 'light' ? 'bg-gray-100' : 'bg-black/20'} font-mono text-[11px] max-h-32 overflow-hidden relative">
                                <pre class="whitespace-pre-wrap">${escapeHtml(story.query_text)}</pre>
                                <div class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t ${theme === 'light' ? 'from-gray-100' : 'from-[#1e1e2e]/0'} to-transparent"></div>
                            </div>

                            ${story.context ? `
                                <div class="text-xs ${classes.text.secondary} leading-relaxed italic">
                                    "${escapeHtml(story.context)}"
                                </div>
                            ` : ''}

                            <div class="flex flex-wrap gap-2">
                                ${(story.tags || []).map(tag => `
                                    <span class="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] border border-blue-500/20">${escapeHtml(tag)}</span>
                                `).join('')}
                            </div>

                            <div class="flex items-center gap-6 mt-2 pt-4 border-t ${theme === 'light' ? 'border-gray-100' : 'border-white/5'}">
                                <div class="flex items-center gap-1.5 ${classes.text.subtle} text-[10px] uppercase font-bold">
                                    <span class="material-symbols-outlined text-[14px]">play_arrow</span>
                                    ${story.execution_count || 0} Executions
                                </div>
                                <div class="flex items-center gap-1.5 ${classes.text.subtle} text-[10px] uppercase font-bold">
                                    <span class="material-symbols-outlined text-[14px]">chat_bubble</span>
                                    ${story.comments?.length || 0} Comments
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Bind events
        container.querySelector('#btn-refresh').onclick = loadStories;
        
        const searchInput = container.querySelector('#story-search');
        searchInput.oninput = (e) => {
            state.searchQuery = e.target.value;
            render();
            // Refocus after render
            container.querySelector('#story-search').focus();
        };

        container.querySelectorAll('.btn-favorite').forEach(btn => {
            btn.onclick = () => toggleFavorite(btn.dataset.hash);
        });

        container.querySelectorAll('.btn-delete-story').forEach(btn => {
            btn.onclick = () => deleteStory(btn.dataset.hash);
        });

        container.querySelectorAll('.btn-view-story').forEach(btn => {
            btn.onclick = () => {
                // Toggle the global story panel for this specific query
                window.dispatchEvent(new CustomEvent('tactilesql:toggle-story-panel', {
                    detail: { queryHash: btn.dataset.hash }
                }));
            };
        });
    };

    window.addEventListener('themechange', (e) => {
        theme = e.detail.theme;
        render();
    });

    loadStories();

    return container;
}
