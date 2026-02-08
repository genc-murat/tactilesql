/**
 * Simple Promise-based wrapper for IndexedDB
 * Lightweight alternative to idb or localforage
 */
export class SimpleIDB {
    constructor(dbName, storeName, version = 1) {
        this.dbName = dbName;
        this.storeName = storeName;
        this.version = version;
        this.db = null;
        this.initPromise = this.#init();
    }

    #init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('SimpleIDB init error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    async #getStore(mode = 'readonly') {
        if (!this.db) {
            await this.initPromise;
        }
        const transaction = this.db.transaction(this.storeName, mode);
        return transaction.objectStore(this.storeName);
    }

    async get(key) {
        const store = await this.#getStore('readonly');
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async set(key, value) {
        const store = await this.#getStore('readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async del(key) {
        const store = await this.#getStore('readwrite');
        return new Promise((resolve, reject) => {
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clear() {
        const store = await this.#getStore('readwrite');
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async keys() {
        const store = await this.#getStore('readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAllKeys();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}
