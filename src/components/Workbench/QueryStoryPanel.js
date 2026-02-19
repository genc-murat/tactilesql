import { QueryStoryAPI } from '../../api/queryStory.js';
import { CustomDropdown } from '../UI/CustomDropdown.js';
import './QueryStoryPanel.css';

/**
 * Query Story Panel - side drawer that shows the narrative of the current query.
 */
export class QueryStoryPanel {
    constructor() {
        this.element = null;
        this.currentQuery = '';
        this.currentHash = '';
        this.story = null;
        this.isVisible = false;
        this.onVersionRestore = null; // Callback for version restore
        this.refs = {};
        this.emptyCopy = {
            title: 'No story yet for this query.',
            description: 'Add purpose, ownership, and version notes to keep the team aligned.'
        };
    }

    render() {
        const panel = document.createElement('aside');
        panel.className = 'query-story-panel hidden';
        panel.innerHTML = `
            <div class="story-panel-header">
                <div class="story-header-text">
                    <span class="eyebrow">Query Story</span>
                    <div class="current-query" title="No query yet">No query yet</div>
                </div>
                <div class="header-actions">
                    <button class="btn-ghost btn-refresh" title="Refresh">
                        <span class="material-symbols-outlined">refresh</span>
                    </button>
                    <button class="btn-ghost btn-create-story" title="New story">
                        <span class="material-symbols-outlined">add</span>
                    </button>
                    <button class="btn-close" title="Close">×</button>
                </div>
            </div>
            <div class="story-panel-content">
                <div class="story-state story-loading hidden">
                    ${this.renderSkeleton()}
                </div>

                <div class="story-state story-empty">
                    <div class="empty-card">
                        <div class="empty-icon">📖</div>
                        <div class="empty-title">${this.emptyCopy.title}</div>
                        <p class="empty-desc">${this.emptyCopy.description}</p>
                        <div class="empty-actions">
                            <button class="btn-primary btn-create-story">Create Story</button>
                            <button class="btn-ghost btn-refresh">Refresh</button>
                        </div>
                    </div>
                </div>

                <div class="story-state story-details hidden">
                    <div class="story-meta-grid">
                        <div class="meta-card meta-wide">
                            <div class="meta-top">
                                <div>
                                    <p class="label">Purpose</p>
                                    <div class="story-purpose" data-ref="purpose">Purpose not provided</div>
                                </div>
                                <button class="btn-ghost btn-edit-context" title="Edit context">
                                    <span class="material-symbols-outlined">edit</span>
                                </button>
                            </div>
                            <p class="muted story-notes" data-ref="notes"></p>
                        </div>

                        <div class="meta-card">
                            <p class="label">Business Domain</p>
                            <div class="meta-value" data-ref="domain">—</div>
                            <div class="pill" data-ref="frequency">Not planned</div>
                        </div>

                        <div class="meta-card">
                            <p class="label">Owner</p>
                            <div class="meta-value" data-ref="author">—</div>
                            <div class="pill subtle" data-ref="executions">0 runs</div>
                        </div>

                        <div class="meta-card tags-card">
                            <p class="label">Tags</p>
                            <div class="story-tags" data-ref="tags"></div>
                        </div>
                    </div>

                    <div class="story-insights">
                        <div class="insight-card">
                            <p class="label">Last Change</p>
                            <div class="meta-value" data-ref="latest-date">—</div>
                            <div class="muted" data-ref="latest-reason">No update note</div>
                        </div>

                        <div class="insight-card badge-card">
                            <p class="label">Version</p>
                            <div class="badge" data-ref="latest-version">—</div>
                        </div>

                        <div class="insight-card badge-card favorite-card">
                            <p class="label">Favorite</p>
                            <button class="btn-favorite pill" data-ref="favorite" title="Mark as favorite">☆ Favorite</button>
                        </div>
                    </div>

                    <div class="story-body-grid">
                        <section class="story-timeline card">
                            <div class="section-header">
                                <div>
                                    <p class="eyebrow">Version History</p>
                                    <h4>Decision trail</h4>
                                </div>
                            </div>
                            <div class="timeline-list" data-ref="timeline"></div>
                        </section>

                        <section class="story-comments card">
                            <div class="section-header">
                                <div>
                                    <p class="eyebrow">Team Notes</p>
                                    <h4>Comments</h4>
                                </div>
                            </div>
                            <div class="comments-list" data-ref="comments"></div>
                            <div class="comment-input">
                                <input type="text" placeholder="Add a comment..." data-ref="comment-input" />
                                <button class="btn-add-comment" data-ref="add-comment" title="Add comment">
                                    <span class="material-symbols-outlined">send</span>
                                </button>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        `;

        this.element = panel;
        this.cacheDom();
        this.attachEventListeners();
        return panel;
    }

    renderSkeleton() {
        return `
            <div class="skeleton-block long"></div>
            <div class="skeleton-grid">
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
            </div>
            <div class="skeleton-block"></div>
            <div class="skeleton-list">
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
                <div class="skeleton-block"></div>
            </div>
        `;
    }

    cacheDom() {
        const q = (selector) => this.element.querySelector(selector);
        this.refs = {
            states: {
                loading: q('.story-loading'),
                empty: q('.story-empty'),
                details: q('.story-details')
            },
            currentQuery: q('.current-query'),
            close: q('.btn-close'),
            refreshButtons: this.element.querySelectorAll('.btn-refresh'),
            createButtons: this.element.querySelectorAll('.btn-create-story'),
            editContext: q('.btn-edit-context'),
            favorite: q('[data-ref="favorite"]'),
            purpose: q('[data-ref="purpose"]'),
            notes: q('[data-ref="notes"]'),
            domain: q('[data-ref="domain"]'),
            frequency: q('[data-ref="frequency"]'),
            author: q('[data-ref="author"]'),
            executions: q('[data-ref="executions"]'),
            tags: q('[data-ref="tags"]'),
            latestVersion: q('[data-ref="latest-version"]'),
            latestDate: q('[data-ref="latest-date"]'),
            latestReason: q('[data-ref="latest-reason"]'),
            timeline: q('[data-ref="timeline"]'),
            comments: q('[data-ref="comments"]'),
            commentInput: q('[data-ref="comment-input"]'),
            addComment: q('[data-ref="add-comment"]')
        };
    }

    attachEventListeners() {
        this.refs.close?.addEventListener('click', () => this.hide());

        this.refs.refreshButtons?.forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.currentQuery) {
                    this.loadStory(this.currentQuery);
                }
            });
        });

        this.refs.createButtons?.forEach(btn => {
            btn.addEventListener('click', () => this.showCreateModal());
        });

        this.refs.editContext?.addEventListener('click', () => {
            if (this.story) this.showEditContextModal();
        });

        this.refs.favorite?.addEventListener('click', () => this.toggleFavorite());

        if (this.refs.addComment && this.refs.commentInput) {
            this.refs.addComment.addEventListener('click', () => {
                this.addComment(this.refs.commentInput.value);
            });

            this.refs.commentInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.addComment(this.refs.commentInput.value);
                }
            });
        }
    }

    setHeaderQueryLabel(query) {
        if (!this.refs.currentQuery) return;
        const firstLine = (query || '').split('\n').find(line => line.trim()) || 'No query yet';
        const trimmed = firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
        this.refs.currentQuery.textContent = trimmed;
        this.refs.currentQuery.title = query || 'No query yet';
    }

    updateEmptyCopy(title, description) {
        const titleEl = this.refs.states.empty?.querySelector('.empty-title');
        const descEl = this.refs.states.empty?.querySelector('.empty-desc');
        if (titleEl) titleEl.textContent = title;
        if (descEl) descEl.textContent = description;
    }

    showEmptyState() {
        this.updateEmptyCopy(this.emptyCopy.title, this.emptyCopy.description);
        this.setView('empty');
    }

    showErrorState(error) {
        const message = error?.message || 'Unexpected error.';
        this.updateEmptyCopy('Could not load story', message);
        this.setView('empty');
    }

    setView(view) {
        Object.entries(this.refs.states).forEach(([key, node]) => {
            if (!node) return;
            if (key === view) {
                node.classList.remove('hidden');
            } else {
                node.classList.add('hidden');
            }
        });
    }

    async loadStory(query) {
        this.currentQuery = query || '';
        this.setHeaderQueryLabel(query);

        if (!query || !query.trim()) {
            this.story = null;
            this.currentHash = '';
            this.showEmptyState();
            return;
        }

        this.setView('loading');
        try {
            const { exists, hash, story } = await QueryStoryAPI.hasStory(query);
            this.currentHash = hash;
            this.story = story;

            if (!exists || !story) {
                this.showEmptyState();
                return;
            }

            this.renderStoryDetails();
            this.setView('details');
        } catch (error) {
            console.error('Error while loading story:', error);
            this.showErrorState(error);
        }
    }

    renderStoryDetails() {
        if (!this.story) return;

        const { context = {}, versions = [], comments = [], isFavorite = false, executionCount = 0, tags = [] } = this.story;

        if (this.refs.purpose) this.refs.purpose.textContent = context.purpose || 'Purpose not provided';
        if (this.refs.notes) this.refs.notes.textContent = context.notes || '';
        if (this.refs.domain) this.refs.domain.textContent = context.businessDomain || 'Unknown';
        if (this.refs.frequency) this.refs.frequency.textContent = this.formatFrequency(context.expectedFrequency);
        if (this.refs.author) this.refs.author.textContent = this.story.author ? `👤 ${this.story.author}` : 'Unknown';
        if (this.refs.executions) this.refs.executions.textContent = `${executionCount || 0} run${(executionCount || 0) === 1 ? '' : 's'}`;

        this.renderTags(tags);
        this.setFavoriteButton(isFavorite);

        const sortedVersions = [...(versions || [])].sort((a, b) => a.versionNumber - b.versionNumber);
        const latestVersion = sortedVersions[sortedVersions.length - 1];

        if (latestVersion) {
            if (this.refs.latestVersion) this.refs.latestVersion.textContent = `v${latestVersion.versionNumber}`;
            if (this.refs.latestDate) this.refs.latestDate.textContent = this.formatDate(latestVersion.changedAt);
            if (this.refs.latestReason) this.refs.latestReason.textContent = latestVersion.changeReason || 'No update note';
        } else {
            if (this.refs.latestVersion) this.refs.latestVersion.textContent = '—';
            if (this.refs.latestDate) this.refs.latestDate.textContent = '—';
            if (this.refs.latestReason) this.refs.latestReason.textContent = 'No update note';
        }

        this.renderTimeline(sortedVersions);
        this.renderComments(comments);
    }

    renderTags(tags = []) {
        if (!this.refs.tags) return;
        if (!tags.length) {
            this.refs.tags.innerHTML = '<span class="tag muted">Etiket yok</span>';
            return;
        }

        this.refs.tags.innerHTML = tags
            .map(tag => `<span class="tag">#${this.escapeHtml(tag)}</span>`)
            .join('');
    }

    renderTimeline(versions = []) {
        const timelineList = this.refs.timeline;
        if (!timelineList) return;

        if (!versions.length) {
            timelineList.innerHTML = '<p class="no-timeline">No versions yet.</p>';
            return;
        }

        timelineList.innerHTML = versions.map((version, index) => {
            const isLatest = index === versions.length - 1;
            const safeReason = this.escapeHtml(version.changeReason || 'No change note');
            const safeSummary = this.escapeHtml(version.diffSummary || '');
            const safeAuthor = this.escapeHtml(version.author || 'Unknown');
            const perf = version.performanceAfter?.executionTimeMs != null
                ? `<div class="version-performance">⏱️ ${Number(version.performanceAfter.executionTimeMs).toFixed(2)}ms</div>`
                : '';

            return `
                <div class="timeline-item ${isLatest ? 'is-latest' : ''}" data-version="${version.versionNumber}">
                    <div class="timeline-marker"></div>
                    <div class="timeline-content">
                        <div class="version-header">
                            <div class="version-left">
                                <span class="version-number">v${version.versionNumber}</span>
                                <span class="version-date">${this.formatDate(version.changedAt)}</span>
                            </div>
                            <div class="version-actions">
                                <button class="btn-view-version" data-version="${version.versionNumber}">View</button>
                                ${isLatest ? '' : `<button class="btn-restore-version" data-version="${version.versionNumber}">Restore</button>`}
                            </div>
                        </div>
                        <div class="version-author">👤 ${safeAuthor}</div>
                        <div class="version-reason">${safeReason}</div>
                        ${safeSummary ? `<div class="version-summary">${safeSummary}</div>` : ''}
                        ${perf}
                    </div>
                </div>
            `;
        }).join('');

        timelineList.querySelectorAll('.btn-view-version').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const versionNum = parseInt(e.currentTarget.dataset.version, 10);
                this.viewVersion(versionNum);
            });
        });

        timelineList.querySelectorAll('.btn-restore-version').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const versionNum = parseInt(e.currentTarget.dataset.version, 10);
                this.restoreVersion(versionNum);
            });
        });
    }

    renderComments(comments = []) {
        const commentsList = this.refs.comments;
        if (!commentsList) return;

        if (!comments.length) {
            commentsList.innerHTML = '<p class="no-comments">No comments yet.</p>';
            return;
        }

        commentsList.innerHTML = comments.map(comment => {
            const safeText = this.escapeHtml(comment.text || '');
            const safeAuthor = this.escapeHtml(comment.author || 'User');
            const lineRef = comment.lineReference ? `<div class="comment-line-ref">Line ${comment.lineReference}</div>` : '';

            return `
                <div class="comment-item" data-comment-id="${comment.id}">
                    <div class="comment-header">
                        <span class="comment-author">👤 ${safeAuthor}</span>
                        <span class="comment-date">${this.formatDate(comment.createdAt)}</span>
                    </div>
                    <div class="comment-text">${safeText}</div>
                    ${lineRef}
                </div>
            `;
        }).join('');
    }

    async addComment(text) {
        if (!text || !text.trim() || !this.currentHash) return;

        const trimmed = text.trim();
        const addButton = this.refs.addComment;

        try {
            if (addButton) addButton.disabled = true;
            const author = localStorage.getItem('username') || 'User';
            await QueryStoryAPI.addComment(this.currentHash, author, trimmed);
            if (this.refs.commentInput) this.refs.commentInput.value = '';
            await this.loadStory(this.currentQuery); // Yenile
        } catch (error) {
            console.error('Error while adding comment:', error);
            alert('Could not add comment: ' + error.message);
        } finally {
            if (addButton) addButton.disabled = false;
        }
    }

    async toggleFavorite() {
        if (!this.currentHash) return;
        try {
            const newStatus = await QueryStoryAPI.toggleFavorite(this.currentHash);
            this.setFavoriteButton(newStatus);
        } catch (error) {
            console.error('Favorite toggle error:', error);
        }
    }

    setFavoriteButton(isFavorite) {
        if (!this.refs.favorite) return;
        this.refs.favorite.classList.toggle('active', !!isFavorite);
        this.refs.favorite.textContent = isFavorite ? '★ Favorite' : '☆ Favorite';
        this.refs.favorite.setAttribute('aria-pressed', !!isFavorite);
    }

    async viewVersion(versionNumber) {
        try {
            const diff = await QueryStoryAPI.compareVersions(this.currentHash, versionNumber, versionNumber);
            this.showVersionDiffModal(diff);
        } catch (error) {
            console.error('Error while viewing version:', error);
        }
    }

    async restoreVersion(versionNumber) {
        if (!confirm(`Are you sure you want to restore v${versionNumber}?`)) {
            return;
        }

        try {
            const version = this.story?.versions?.find(v => v.versionNumber === versionNumber);
            if (version && this.onVersionRestore) {
                this.onVersionRestore(version.queryText);
            }
        } catch (error) {
            console.error('Version restore error:', error);
        }
    }

    showCreateModal() {
        const modal = document.createElement('div');
        modal.className = 'modal query-story-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>📖 Create Query Story</h3>
                <form class="story-form">
                    <div class="form-group">
                        <label>Purpose / Description</label>
                        <textarea name="purpose" placeholder="What does this query deliver?" required></textarea>
                    </div>
                    <div class="form-group">
                        <label>Business Domain</label>
                        <div id="business-domain-container"></div>
                    </div>
                    <div class="form-group">
                        <label>Expected Frequency</label>
                        <div id="frequency-container"></div>
                    </div>
                    <div class="form-group">
                        <label>Tags (comma separated)</label>
                        <input type="text" name="tags" placeholder="report, analysis, critical" />
                    </div>
                    <div class="form-group">
                        <label>Notes / Assumptions</label>
                        <textarea name="notes" placeholder="Assumptions, risks, data source notes"></textarea>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn-cancel">Cancel</button>
                        <button type="submit" class="btn-primary">Create</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        const businessDomainItems = [
            { value: '', label: 'Select...' },
            { value: 'Finance', label: 'Finance' },
            { value: 'Operations', label: 'Operations' },
            { value: 'Marketing', label: 'Marketing' },
            { value: 'HR', label: 'HR' },
            { value: 'Technical', label: 'Technical' },
            { value: 'Other', label: 'Other' }
        ];
        const businessDomainDropdown = new CustomDropdown({
            id: 'business-domain-dropdown',
            items: businessDomainItems,
            placeholder: 'Select...',
            searchable: false
        });
        const businessDomainContainer = modal.querySelector('#business-domain-container');
        if (businessDomainContainer) businessDomainContainer.appendChild(businessDomainDropdown.getElement());

        const frequencyItems = [
            { value: 'OneTime', label: 'One time' },
            { value: 'Daily', label: 'Daily' },
            { value: 'Weekly', label: 'Weekly' },
            { value: 'Monthly', label: 'Monthly' },
            { value: 'Quarterly', label: 'Quarterly' },
            { value: 'Yearly', label: 'Yearly' },
            { value: 'OnDemand', label: 'On demand' }
        ];
        const frequencyDropdown = new CustomDropdown({
            id: 'frequency-dropdown',
            items: frequencyItems,
            value: 'OnDemand',
            searchable: false
        });
        const frequencyContainer = modal.querySelector('#frequency-container');
        if (frequencyContainer) frequencyContainer.appendChild(frequencyDropdown.getElement());

        modal.querySelector('.btn-cancel').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);

            const context = {
                purpose: formData.get('purpose'),
                businessDomain: businessDomainDropdown.value || '',
                expectedFrequency: frequencyDropdown.value || 'OnDemand',
                stakeholders: [],
                relatedTables: [],
                notes: formData.get('notes') || ''
            };

            const rawTags = formData.get('tags') || '';
            const tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);
            const author = localStorage.getItem('username') || 'User';

            try {
                await QueryStoryAPI.createStory(this.currentQuery, author, context, tags);
                modal.remove();
                await this.loadStory(this.currentQuery);
            } catch (error) {
                console.error('Story creation error:', error);
                alert('Story could not be created: ' + error.message);
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    showEditContextModal() {
        const modal = document.createElement('div');
        modal.className = 'modal query-story-modal';

        const context = this.story?.context || {};
        const tagsValue = (this.story?.tags || []).join(', ');
        const frequency = context.expectedFrequency || 'OnDemand';

        modal.innerHTML = `
            <div class="modal-content">
                <h3>✏️ Edit Context</h3>
                <form class="story-form">
                    <div class="form-group">
                        <label>Purpose</label>
                        <textarea name="purpose">${context.purpose || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Business Domain</label>
                        <input type="text" name="businessDomain" value="${context.businessDomain || ''}" />
                    </div>
                    <div class="form-group">
                        <label>Expected Frequency</label>
                        <div id="edit-frequency-container"></div>
                    </div>
                    <div class="form-group">
                        <label>Tags</label>
                        <input type="text" name="tags" value="${tagsValue}" />
                    </div>
                    <div class="form-group">
                        <label>Notes</label>
                        <textarea name="notes">${context.notes || ''}</textarea>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn-cancel">Cancel</button>
                        <button type="submit" class="btn-primary">Save</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        const frequencyItems = [
            { value: 'OneTime', label: 'One time' },
            { value: 'Daily', label: 'Daily' },
            { value: 'Weekly', label: 'Weekly' },
            { value: 'Monthly', label: 'Monthly' },
            { value: 'Quarterly', label: 'Quarterly' },
            { value: 'Yearly', label: 'Yearly' },
            { value: 'OnDemand', label: 'On demand' }
        ];
        const frequencyDropdown = new CustomDropdown({
            id: 'edit-frequency-dropdown',
            items: frequencyItems,
            value: frequency,
            searchable: false
        });
        const frequencyContainer = modal.querySelector('#edit-frequency-container');
        if (frequencyContainer) frequencyContainer.appendChild(frequencyDropdown.getElement());

        modal.querySelector('.btn-cancel').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);

            const updatedContext = {
                ...context,
                purpose: formData.get('purpose'),
                businessDomain: formData.get('businessDomain'),
                expectedFrequency: frequencyDropdown.value || 'OnDemand',
                notes: formData.get('notes') || ''
            };

            const rawTags = formData.get('tags') || '';
            const tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);

            try {
                await QueryStoryAPI.updateContext(this.currentHash, updatedContext, tags);
                modal.remove();
                await this.loadStory(this.currentQuery);
            } catch (error) {
                console.error('Context update error:', error);
                alert('Context could not be updated: ' + error.message);
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    showVersionDiffModal(diff) {
        const modal = document.createElement('div');
        modal.className = 'modal version-diff-modal';
        modal.innerHTML = `
            <div class="modal-content large">
                <h3>🔍 Version Comparison</h3>
                <div class="diff-summary">${this.escapeHtml(diff.summary)}</div>
                <div class="diff-content">
                    ${diff.diffLines.map(line => {
                        let className = 'diff-line';
                        let prefix = '  ';
                        if (line.changeType === 'Added') {
                            className += ' added';
                            prefix = '+ ';
                        } else if (line.changeType === 'Removed') {
                            className += ' removed';
                            prefix = '- ';
                        }
                        const content = line.newContent || line.oldContent || '';
                        return `<div class="${className}"><span class="line-num">${line.lineNumber}</span>${prefix}${this.escapeHtml(content)}</div>`;
                    }).join('')}
                </div>
                <div class="form-actions">
                    <button class="btn-close-modal">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.btn-close-modal').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    show() {
        this.isVisible = true;
        this.element.classList.remove('hidden');
    }

    hide() {
        this.isVisible = false;
        this.element.classList.add('hidden');
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    // Helper methods
    formatFrequency(freq) {
        const map = {
            'OneTime': '🔴 One time',
            'Daily': '📅 Daily',
            'Weekly': '📅 Weekly',
            'Monthly': '📅 Monthly',
            'Quarterly': '📅 Quarterly',
            'Yearly': '📅 Yearly',
            'OnDemand': '⚡ On demand'
        };
        return map[freq] || 'Not planned';
    }

    formatDate(dateString) {
        if (!dateString) return '—';
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString(navigator.language || 'en-US', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }
}

export default QueryStoryPanel;
