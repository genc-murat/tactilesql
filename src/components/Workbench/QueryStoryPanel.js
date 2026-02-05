import { QueryStoryAPI } from '../../api/queryStory.js';
import './QueryStoryPanel.css';

/**
 * Query Story Panel - Workbench'te sorgu hikayesini gösteren yan panel
 */
export class QueryStoryPanel {
    constructor() {
        this.element = null;
        this.currentQuery = '';
        this.currentHash = '';
        this.story = null;
        this.isVisible = false;
        this.onVersionRestore = null; // Callback versiyon geri yükleme için
    }

    render() {
        const panel = document.createElement('div');
        panel.className = 'query-story-panel hidden';
        panel.innerHTML = `
            <div class="story-panel-header">
                <h3>📖 Query Story</h3>
                <button class="btn-close" title="Kapat">×</button>
            </div>
            <div class="story-panel-content">
                <div class="story-empty-state">
                    <p>Bu sorgunun henüz bir hikayesi yok.</p>
                    <button class="btn-create-story">Hikaye Oluştur</button>
                </div>
                <div class="story-details hidden">
                    <!-- Context Card -->
                    <div class="story-context-card">
                        <div class="context-header">
                            <span class="story-purpose"></span>
                            <button class="btn-edit-context" title="Düzenle">✏️</button>
                        </div>
                        <div class="context-meta">
                            <span class="story-author"></span>
                            <span class="story-frequency"></span>
                        </div>
                        <div class="story-tags"></div>
                        <div class="story-stats">
                            <span class="execution-count"></span>
                            <button class="btn-favorite" title="Favori">⭐</button>
                        </div>
                    </div>

                    <!-- Timeline -->
                    <div class="story-timeline">
                        <h4>Versiyon Geçmişi</h4>
                        <div class="timeline-list"></div>
                    </div>

                    <!-- Comments -->
                    <div class="story-comments">
                        <h4>Yorumlar</h4>
                        <div class="comments-list"></div>
                        <div class="comment-input">
                            <input type="text" placeholder="Yorum ekle..." />
                            <button class="btn-add-comment">➕</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.element = panel;
        this.attachEventListeners();
        return panel;
    }

    attachEventListeners() {
        // Kapat butonu
        this.element.querySelector('.btn-close').addEventListener('click', () => {
            this.hide();
        });

        // Hikaye oluştur
        this.element.querySelector('.btn-create-story')?.addEventListener('click', () => {
            this.showCreateModal();
        });

        // Context düzenle
        this.element.querySelector('.btn-edit-context')?.addEventListener('click', () => {
            this.showEditContextModal();
        });

        // Favori toggle
        this.element.querySelector('.btn-favorite')?.addEventListener('click', () => {
            this.toggleFavorite();
        });

        // Yorum ekle
        const commentInput = this.element.querySelector('.comment-input input');
        const addCommentBtn = this.element.querySelector('.btn-add-comment');
        
        addCommentBtn?.addEventListener('click', () => {
            this.addComment(commentInput.value);
            commentInput.value = '';
        });

        commentInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addComment(commentInput.value);
                commentInput.value = '';
            }
        });
    }

    async loadStory(query) {
        this.currentQuery = query;
        
        try {
            const { exists, hash, story } = await QueryStoryAPI.hasStory(query);
            this.currentHash = hash;
            this.story = story;

            if (exists) {
                this.showStoryDetails();
            } else {
                this.showEmptyState();
            }
        } catch (error) {
            console.error('Story yüklenirken hata:', error);
            this.showEmptyState();
        }
    }

    showEmptyState() {
        this.element.querySelector('.story-empty-state').classList.remove('hidden');
        this.element.querySelector('.story-details').classList.add('hidden');
    }

    showStoryDetails() {
        this.element.querySelector('.story-empty-state').classList.add('hidden');
        this.element.querySelector('.story-details').classList.remove('hidden');

        const { context, versions, comments, isFavorite, executionCount } = this.story;

        // Context
        this.element.querySelector('.story-purpose').textContent = context.purpose || 'Amaç belirtilmemiş';
        this.element.querySelector('.story-author').textContent = `👤 ${this.story.author}`;
        this.element.querySelector('.story-frequency').textContent = this.formatFrequency(context.expectedFrequency);
        
        // Tags
        const tagsContainer = this.element.querySelector('.story-tags');
        tagsContainer.innerHTML = (this.story.tags || []).map(tag => 
            `<span class="tag">#${tag}</span>`
        ).join('');

        // Stats
        this.element.querySelector('.execution-count').textContent = `🚀 ${executionCount || 0} çalıştırma`;
        this.element.querySelector('.btn-favorite').textContent = isFavorite ? '⭐' : '☆';

        // Timeline
        this.renderTimeline(versions);

        // Comments
        this.renderComments(comments);
    }

    renderTimeline(versions) {
        const timelineList = this.element.querySelector('.timeline-list');
        timelineList.innerHTML = versions.map((version, index) => `
            <div class="timeline-item" data-version="${version.versionNumber}">
                <div class="timeline-marker ${index === versions.length - 1 ? 'latest' : ''}"></div>
                <div class="timeline-content">
                    <div class="version-header">
                        <span class="version-number">v${version.versionNumber}</span>
                        <span class="version-date">${this.formatDate(version.changedAt)}</span>
                    </div>
                    <div class="version-author">👤 ${version.author}</div>
                    <div class="version-reason">${version.changeReason}</div>
                    <div class="version-summary">${version.diffSummary}</div>
                    ${version.performanceAfter ? `
                        <div class="version-performance">
                            ⏱️ ${version.performanceAfter.executionTimeMs.toFixed(2)}ms
                        </div>
                    ` : ''}
                    <div class="version-actions">
                        <button class="btn-view-version" data-version="${version.versionNumber}">Görüntüle</button>
                        ${index !== versions.length - 1 ? `
                            <button class="btn-restore-version" data-version="${version.versionNumber}">Geri Yükle</button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `).join('');

        // Versiyon butonlarına event listener ekle
        timelineList.querySelectorAll('.btn-view-version').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const versionNum = parseInt(e.target.dataset.version);
                this.viewVersion(versionNum);
            });
        });

        timelineList.querySelectorAll('.btn-restore-version').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const versionNum = parseInt(e.target.dataset.version);
                this.restoreVersion(versionNum);
            });
        });
    }

    renderComments(comments) {
        const commentsList = this.element.querySelector('.comments-list');
        if (!comments || comments.length === 0) {
            commentsList.innerHTML = '<p class="no-comments">Henüz yorum yok.</p>';
            return;
        }

        commentsList.innerHTML = comments.map(comment => `
            <div class="comment-item" data-comment-id="${comment.id}">
                <div class="comment-header">
                    <span class="comment-author">👤 ${comment.author}</span>
                    <span class="comment-date">${this.formatDate(comment.createdAt)}</span>
                </div>
                <div class="comment-text">${comment.text}</div>
                ${comment.lineReference ? `
                    <div class="comment-line-ref">Satır ${comment.lineReference}</div>
                ` : ''}
            </div>
        `).join('');
    }

    async addComment(text) {
        if (!text.trim()) return;

        try {
            const author = localStorage.getItem('username') || 'Kullanıcı';
            await QueryStoryAPI.addComment(this.currentHash, author, text);
            await this.loadStory(this.currentQuery); // Yenile
        } catch (error) {
            console.error('Yorum eklenirken hata:', error);
            alert('Yorum eklenemedi: ' + error.message);
        }
    }

    async toggleFavorite() {
        try {
            const newStatus = await QueryStoryAPI.toggleFavorite(this.currentHash);
            this.element.querySelector('.btn-favorite').textContent = newStatus ? '⭐' : '☆';
        } catch (error) {
            console.error('Favori toggle hatası:', error);
        }
    }

    async viewVersion(versionNumber) {
        try {
            const diff = await QueryStoryAPI.compareVersions(this.currentHash, versionNumber, versionNumber);
            this.showVersionDiffModal(diff);
        } catch (error) {
            console.error('Versiyon görüntüleme hatası:', error);
        }
    }

    async restoreVersion(versionNumber) {
        if (!confirm(`v${versionNumber} versiyonunu geri yüklemek istediğinize emin misiniz?`)) {
            return;
        }

        try {
            const version = this.story.versions.find(v => v.versionNumber === versionNumber);
            if (version && this.onVersionRestore) {
                this.onVersionRestore(version.queryText);
            }
        } catch (error) {
            console.error('Versiyon geri yükleme hatası:', error);
        }
    }

    showCreateModal() {
        // Modal oluştur
        const modal = document.createElement('div');
        modal.className = 'modal query-story-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>📖 Yeni Query Story Oluştur</h3>
                <form class="story-form">
                    <div class="form-group">
                        <label>Amaç / Açıklama</label>
                        <textarea name="purpose" placeholder="Bu sorgu ne için kullanılıyor?" required></textarea>
                    </div>
                    <div class="form-group">
                        <label>İş Domaini</label>
                        <select name="businessDomain">
                            <option value="">Seçin...</option>
                            <option value="Finans">Finans</option>
                            <option value="Operasyon">Operasyon</option>
                            <option value="Pazarlama">Pazarlama</option>
                            <option value="İK">İK</option>
                            <option value="Teknik">Teknik</option>
                            <option value="Diğer">Diğer</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Beklenen Sıklık</label>
                        <select name="frequency">
                            <option value="OneTime">Bir kez</option>
                            <option value="Daily">Günlük</option>
                            <option value="Weekly">Haftalık</option>
                            <option value="Monthly">Aylık</option>
                            <option value="Quarterly">3 Aylık</option>
                            <option value="Yearly">Yıllık</option>
                            <option value="OnDemand">İhtiyaç halinde</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Etiketler (virgülle ayırın)</label>
                            <input type="text" name="tags" placeholder="rapor, analiz, kritik" />
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn-cancel">İptal</button>
                        <button type="submit" class="btn-primary">Oluştur</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        modal.querySelector('.btn-cancel').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            
            const context = {
                purpose: formData.get('purpose'),
                businessDomain: formData.get('businessDomain'),
                expectedFrequency: formData.get('frequency'),
                stakeholders: [],
                relatedTables: [],
                notes: ''
            };

            const tags = formData.get('tags').split(',').map(t => t.trim()).filter(t => t);
            const author = localStorage.getItem('username') || 'Kullanıcı';

            try {
                await QueryStoryAPI.createStory(this.currentQuery, author, context, tags);
                modal.remove();
                await this.loadStory(this.currentQuery);
            } catch (error) {
                console.error('Story oluşturma hatası:', error);
                alert('Story oluşturulamadı: ' + error.message);
            }
        });

        // Modal dışına tıklayınca kapat
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    showEditContextModal() {
        // Context düzenleme modalı
        const modal = document.createElement('div');
        modal.className = 'modal query-story-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>✏️ Context Düzenle</h3>
                <form class="story-form">
                    <div class="form-group">
                        <label>Amaç</label>
                        <textarea name="purpose">${this.story.context.purpose}</textarea>
                    </div>
                    <div class="form-group">
                        <label>İş Domaini</label>
                        <input type="text" name="businessDomain" value="${this.story.context.businessDomain}" />
                    </div>
                    <div class="form-group">
                        <label>Etiketler</label>
                        <input type="text" name="tags" value="${this.story.tags.join(', ')}" />
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn-cancel">İptal</button>
                        <button type="submit" class="btn-primary">Kaydet</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.btn-cancel').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            
            const context = {
                ...this.story.context,
                purpose: formData.get('purpose'),
                businessDomain: formData.get('businessDomain')
            };

            const tags = formData.get('tags').split(',').map(t => t.trim()).filter(t => t);

            try {
                await QueryStoryAPI.updateContext(this.currentHash, context, tags);
                modal.remove();
                await this.loadStory(this.currentQuery);
            } catch (error) {
                console.error('Context güncelleme hatası:', error);
                alert('Context güncellenemedi: ' + error.message);
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
                <h3>🔍 Versiyon Karşılaştırma</h3>
                <div class="diff-summary">${diff.summary}</div>
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
                    <button class="btn-close-modal">Kapat</button>
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

    // Yardımcı metodlar
    formatFrequency(freq) {
        const map = {
            'OneTime': '🔴 Bir kez',
            'Daily': '📅 Günlük',
            'Weekly': '📅 Haftalık',
            'Monthly': '📅 Aylık',
            'Quarterly': '📅 3 Aylık',
            'Yearly': '📅 Yıllık',
            'OnDemand': '⚡ İhtiyaç halinde'
        };
        return map[freq] || freq;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('tr-TR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

export default QueryStoryPanel;
