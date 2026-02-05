import { invoke } from '@tauri-apps/api/core';

/**
 * Query Story API - Tauri backend komutları için wrapper
 */

export const QueryStoryAPI = {
    /**
     * Yeni query story oluştur
     */
    async createStory(queryText, author, context, tags = []) {
        return await invoke('create_query_story', {
            request: {
                queryText,
                author,
                context,
                tags
            }
        });
    },

    /**
     * Query hash'e göre story getir
     */
    async getStory(queryHash) {
        return await invoke('get_query_story', { queryHash });
    },

    /**
     * Tüm story'leri listele
     */
    async getAllStories(limit = 100) {
        return await invoke('get_all_query_stories', { limit });
    },

    /**
     * Yeni versiyon ekle
     */
    async addVersion(queryHash, newQueryText, author, changeReason, performanceBefore = null, performanceAfter = null) {
        return await invoke('add_query_version', {
            request: {
                queryHash,
                newQueryText,
                author,
                changeReason,
                performanceBefore,
                performanceAfter
            }
        });
    },

    /**
     * Yorum ekle
     */
    async addComment(queryHash, author, text, lineReference = null, parentId = null) {
        return await invoke('add_query_comment', {
            request: {
                queryHash,
                author,
                text,
                lineReference,
                parentId
            }
        });
    },

    /**
     * Context güncelle
     */
    async updateContext(queryHash, context, tags) {
        return await invoke('update_query_context', {
            request: {
                queryHash,
                context,
                tags
            }
        });
    },

    /**
     * Favori toggle
     */
    async toggleFavorite(queryHash) {
        return await invoke('toggle_query_favorite', { queryHash });
    },

    /**
     * Çalıştırma sayacını artır
     */
    async incrementExecution(queryHash) {
        return await invoke('increment_query_execution', { queryHash });
    },

    /**
     * İki versiyonu karşılaştır
     */
    async compareVersions(queryHash, version1, version2) {
        return await invoke('compare_query_versions', { queryHash, version1, version2 });
    },

    /**
     * Story sil
     */
    async deleteStory(queryHash) {
        return await invoke('delete_query_story', { queryHash });
    },

    /**
     * Query hash hesapla
     */
    async calculateQueryHash(query) {
        return await invoke('calculate_query_hash', { query });
    },

    /**
     * Mevcut query için story var mı kontrol et
     */
    async hasStory(query) {
        const hash = await this.calculateQueryHash(query);
        const story = await this.getStory(hash);
        return { exists: !!story, hash, story };
    }
};

export default QueryStoryAPI;
