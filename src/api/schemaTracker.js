import { invoke } from '@tauri-apps/api/core';

export const SchemaTrackerApi = {
    /**
     * Captures a new schema snapshot for the given connection.
     * @param {string} connectionId 
     * @returns {Promise<SchemaSnapshot>}
     */
    async captureSnapshot(connectionId) {
        return await invoke('capture_schema_snapshot', { connectionId });
    },

    /**
     * Compares two schema snapshots.
     * @param {SchemaSnapshot} snapshot1 
     * @param {SchemaSnapshot} snapshot2 
     * @returns {Promise<SchemaDiff>}
     */
    async compareSnapshots(snapshot1, snapshot2) {
        return await invoke('compare_schema_snapshots', { snapshot1, snapshot2 });
    },

    /**
     * Detects breaking changes in a schema diff.
     * @param {SchemaDiff} diff 
     * @returns {Promise<BreakingChange[]>}
     */
    async detectBreakingChanges(diff) {
        return await invoke('detect_breaking_changes', { diff });
    },

    /**
     * Generates a SQL migration script from a schema diff.
     * @param {SchemaDiff} diff 
     * @param {string} dbType - 'mysql' or 'postgresql'
     * @returns {Promise<string>}
     */
    async generateMigration(diff, dbType) {
        return await invoke('generate_migration', { diff, dbType });
    },

    /**
     * Adds a tag/annotation to a snapshot.
     * @param {number} snapshotId 
     * @param {string} tag 
     * @param {string} annotation 
     * @returns {Promise<void>}
     */
    async addSnapshotTag(snapshotId, tag, annotation) {
        return await invoke('add_snapshot_tag', { snapshotId, tag, annotation });
    },

    /**
     * Gets all snapshots for a connection.
     * @param {string} connectionId
     * @returns {Promise<SchemaSnapshot[]>}
     */
    async getSnapshots(connectionId) {
        return await invoke('get_schema_snapshots', { connectionId });
    },

    /**
     * Generates a story from a schema diff.
     * @param {SchemaSnapshot} snapshot1
     * @param {SchemaSnapshot} snapshot2
     * @returns {Promise<Story>}
     */
    async generateStory(snapshot1, snapshot2) {
        return await invoke('generate_story_command', { snapshot1, snapshot2 });
    }
};
