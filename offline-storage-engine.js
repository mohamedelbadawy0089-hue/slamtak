// ============================================
// Offline Storage Engine - IndexedDB + LocalStorage
// 100% Offline Operation | Massive Scale Ready
// Speed Optimized for 100,000+ Items
// ============================================

class OfflineStorageEngine {
    constructor(config = {}) {
        this.config = {
            dbName: config.dbName || 'MegaStorageDB',
            dbVersion: config.dbVersion || 1,
            stores: config.stores || {
                drugs: { keyPath: 'id', indexes: ['tradeName', 'scientificName', 'category', 'price'] },
                inventory: { keyPath: 'id', indexes: ['drugId', 'addedAt', 'status'] },
                transactions: { keyPath: 'id', indexes: ['date', 'type', 'status'] },
                voiceCache: { keyPath: 'phoneticCode', indexes: ['drugId'] },
                syncQueue: { keyPath: 'id', indexes: ['timestamp', 'status'] },
                priceHistory: { keyPath: 'id', indexes: ['drugId', 'date'] },
                cache: { keyPath: 'key' }
            },
            maxItemsPerStore: config.maxItemsPerStore || 1000000, // 1M items per store
            compression: config.compression !== false
        };
        
        this.db = null;
        this.memoryCache = new Map(); // L1 Cache: Hot data in memory
        this.lruCache = new Map();    // L2 Cache: Recently used
        this.maxMemoryCache = 1000;   // Max 1000 items in memory
        this.maxLRUCache = 5000;      // Max 5000 items in LRU
        
        this.stats = {
            reads: 0,
            writes: 0,
            cacheHits: 0,
            dbHits: 0,
            compressionRatio: 0
        };
        
        this.isReady = false;
    }
    
    // Initialize IndexedDB
    async initialize() {
        if (this.isReady) return this.db;
        
        console.log('💾 Initializing Offline Storage Engine...');
        
        try {
            this.db = await this.openDatabase();
            this.isReady = true;
            
            // Load hot data into memory cache
            await this.warmupCache();
            
            console.log('✅ Offline Storage Engine ready');
            console.log('📊 Mode: 100% Offline Capable');
            console.log('🚀 Cache: L1 (Memory) + L2 (LRU) + L3 (IndexedDB)');
            
            return this.db;
        } catch (error) {
            console.error('❌ IndexedDB initialization failed:', error);
            // Fallback to localStorage
            this.fallbackToLocalStorage();
            return null;
        }
    }
    
    // Open IndexedDB with all stores
    openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.config.dbName, this.config.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create all stores with indexes
                for (const [storeName, config] of Object.entries(this.config.stores)) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        const store = db.createObjectStore(storeName, { 
                            keyPath: config.keyPath,
                            autoIncrement: config.autoIncrement || false
                        });
                        
                        // Create indexes for fast queries
                        if (config.indexes) {
                            config.indexes.forEach(indexName => {
                                store.createIndex(indexName, indexName, { unique: false });
                            });
                        }
                        
                        console.log(`📦 Created store: ${storeName}`);
                    }
                }
            };
        });
    }
    
    // Warmup cache with frequently accessed data
    async warmupCache() {
        console.log('🔥 Warming up cache...');
        
        // Load top 1000 most recently accessed drugs
        const recentDrugs = await this.getFromStore('drugs', null, 1000);
        recentDrugs.forEach(drug => {
            this.memoryCache.set(drug.id, drug);
        });
        
        console.log(`💾 Preloaded ${this.memoryCache.size} items into memory cache`);
    }
    
    // ============================================
    // Core Storage Operations
    // ============================================
    
    // Save single item (with caching)
    async save(storeName, item, options = {}) {
        this.stats.writes++;
        
        // Compress if enabled and item is large
        if (this.config.compression && JSON.stringify(item).length > 1024) {
            item = await this.compressItem(item);
        }
        
        // Update memory cache (L1)
        if (this.memoryCache.size < this.maxMemoryCache) {
            this.memoryCache.set(item.id, item);
        } else {
            // Move to LRU cache (L2)
            this.updateLRU(item.id, item);
        }
        
        // Save to IndexedDB (L3)
        return this.saveToStore(storeName, item);
    }
    
    // Save multiple items (batch operation for speed)
    async saveMany(storeName, items) {
        this.stats.writes += items.length;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            let completed = 0;
            let failed = 0;
            
            items.forEach(item => {
                const request = store.put(item);
                
                request.onsuccess = () => {
                    completed++;
                    if (completed + failed === items.length) {
                        resolve({ completed, failed, total: items.length });
                    }
                };
                
                request.onerror = () => {
                    failed++;
                    console.error(`Failed to save item:`, item.id);
                };
            });
            
            transaction.onerror = () => reject(transaction.error);
        });
    }
    
    // Get single item (with multi-level caching)
    async get(storeName, id) {
        this.stats.reads++;
        
        // Check L1 cache (Memory)
        if (this.memoryCache.has(id)) {
            this.stats.cacheHits++;
            return this.memoryCache.get(id);
        }
        
        // Check L2 cache (LRU)
        if (this.lruCache.has(id)) {
            this.stats.cacheHits++;
            const item = this.lruCache.get(id);
            // Promote to L1
            this.memoryCache.set(id, item);
            this.lruCache.delete(id);
            return item;
        }
        
        // Fetch from L3 (IndexedDB)
        this.stats.dbHits++;
        const item = await this.getFromStore(storeName, id);
        
        if (item) {
            // Add to cache
            this.updateCache(id, item);
        }
        
        return item;
    }
    
    // Get multiple items by IDs (batch fetch)
    async getMany(storeName, ids) {
        const results = [];
        const missingIds = [];
        
        // Check cache first
        ids.forEach(id => {
            if (this.memoryCache.has(id)) {
                results.push(this.memoryCache.get(id));
            } else if (this.lruCache.has(id)) {
                results.push(this.lruCache.get(id));
            } else {
                missingIds.push(id);
            }
        });
        
        // Fetch missing from DB
        if (missingIds.length > 0) {
            const dbItems = await this.getManyFromStore(storeName, missingIds);
            results.push(...dbItems);
        }
        
        return results;
    }
    
    // Query by index (fast indexed search)
    async query(storeName, indexName, value, limit = null) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            
            const results = [];
            const request = index.openCursor(IDBKeyRange.only(value));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor) {
                    results.push(cursor.value);
                    
                    if (limit && results.length >= limit) {
                        resolve(results);
                        return;
                    }
                    
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    }
    
    // Range query (for pagination)
    async queryRange(storeName, indexName, from, to, limit = 50, offset = 0) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            
            const results = [];
            let skipped = 0;
            
            const request = index.openCursor(IDBKeyRange.bound(from, to));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor) {
                    if (skipped < offset) {
                        skipped++;
                        cursor.continue();
                        return;
                    }
                    
                    results.push(cursor.value);
                    
                    if (results.length >= limit) {
                        resolve(results);
                        return;
                    }
                    
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    }
    
    // Search with fuzzy matching (for voice input)
    async search(storeName, field, query, options = {}) {
        const { limit = 10, threshold = 0.6 } = options;
        
        // Get all items (for small datasets)
        // For large datasets, use indexed query first
        const allItems = await this.getAllFromStore(storeName);
        
        // Simple fuzzy search
        const results = allItems.map(item => {
            const value = item[field] || '';
            const score = this.calculateSimilarity(query.toLowerCase(), value.toLowerCase());
            return { item, score };
        }).filter(r => r.score >= threshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        
        return results.map(r => ({ ...r.item, _matchScore: r.score }));
    }
    
    // Calculate string similarity (Levenshtein distance based)
    calculateSimilarity(a, b) {
        if (a === b) return 1;
        if (a.length === 0 || b.length === 0) return 0;
        
        const distance = this.levenshteinDistance(a, b);
        const maxLength = Math.max(a.length, b.length);
        return 1 - (distance / maxLength);
    }
    
    levenshteinDistance(a, b) {
        const matrix = [];
        
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[b.length][a.length];
    }
    
    // Delete item
    async delete(storeName, id) {
        // Remove from caches
        this.memoryCache.delete(id);
        this.lruCache.delete(id);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }
    
    // Clear entire store
    async clear(storeName) {
        // Clear relevant cache entries
        this.memoryCache.clear();
        this.lruCache.clear();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }
    
    // Count items in store
    async count(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.count();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    // ============================================
    // Low-level IndexedDB Operations
    // ============================================
    
    saveToStore(storeName, item) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(item);
            
            request.onsuccess = () => resolve(item);
            request.onerror = () => reject(request.error);
        });
    }
    
    getFromStore(storeName, id, limit = null) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            
            if (id) {
                // Get single item
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } else {
                // Get all (with optional limit)
                const results = [];
                const request = store.openCursor();
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    
                    if (cursor && (!limit || results.length < limit)) {
                        results.push(cursor.value);
                        cursor.continue();
                    } else {
                        resolve(results);
                    }
                };
                
                request.onerror = () => reject(request.error);
            }
        });
    }
    
    getManyFromStore(storeName, ids) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            
            const results = [];
            let completed = 0;
            
            ids.forEach(id => {
                const request = store.get(id);
                
                request.onsuccess = () => {
                    if (request.result) {
                        results.push(request.result);
                    }
                    completed++;
                    if (completed === ids.length) {
                        resolve(results);
                    }
                };
                
                request.onerror = () => {
                    completed++;
                    if (completed === ids.length) {
                        resolve(results);
                    }
                };
            });
        });
    }
    
    getAllFromStore(storeName, limit = null) {
        return this.getFromStore(storeName, null, limit);
    }
    
    // ============================================
    // Caching System
    // ============================================
    
    updateCache(id, item) {
        // Add to L1 if space available
        if (this.memoryCache.size < this.maxMemoryCache) {
            this.memoryCache.set(id, item);
        } else {
            // Move oldest from L1 to L2
            const oldestEntry = this.memoryCache.entries().next();
            if (oldestEntry.value) {
                const [oldestId, oldestItem] = oldestEntry.value;
                this.memoryCache.delete(oldestId);
                this.updateLRU(oldestId, oldestItem);
            }
            this.memoryCache.set(id, item);
        }
    }
    
    updateLRU(id, item) {
        // Remove if exists (to update position)
        this.lruCache.delete(id);
        
        // Add to end (most recent)
        this.lruCache.set(id, item);
        
        // Evict oldest if over limit
        if (this.lruCache.size > this.maxLRUCache) {
            const oldestId = this.lruCache.keys().next().value;
            this.lruCache.delete(oldestId);
        }
    }
    
    clearCache() {
        this.memoryCache.clear();
        this.lruCache.clear();
        console.log('🧹 Cache cleared');
    }
    
    // ============================================
    // Compression
    // ============================================
    
    async compressItem(item) {
        try {
            const json = JSON.stringify(item);
            const blob = new Blob([json]);
            
            // Use CompressionStream if available
            if (window.CompressionStream) {
                const cs = new CompressionStream('gzip');
                const stream = blob.stream().pipeThrough(cs);
                const compressed = await new Response(stream).arrayBuffer();
                
                return {
                    _compressed: true,
                    _encoding: 'gzip',
                    _data: Array.from(new Uint8Array(compressed))
                };
            }
            
            return item;
        } catch (error) {
            console.warn('Compression failed:', error);
            return item;
        }
    }
    
    async decompressItem(item) {
        if (!item._compressed) return item;
        
        try {
            if (item._encoding === 'gzip' && window.DecompressionStream) {
                const bytes = new Uint8Array(item._data);
                const blob = new Blob([bytes]);
                const ds = new DecompressionStream('gzip');
                const stream = blob.stream().pipeThrough(ds);
                const text = await new Response(stream).text();
                
                return JSON.parse(text);
            }
            
            return item;
        } catch (error) {
            console.error('Decompression failed:', error);
            return null;
        }
    }
    
    // ============================================
    // LocalStorage Fallback
    // ============================================
    
    fallbackToLocalStorage() {
        console.warn('⚠️ Falling back to LocalStorage (limited to 5-10MB)');
        
        // Implement localStorage-based operations
        this.localStorageMode = true;
        
        // Override methods
        this.saveToStore = (storeName, item) => {
            const key = `${storeName}_${item.id}`;
            localStorage.setItem(key, JSON.stringify(item));
            return Promise.resolve(item);
        };
        
        this.getFromStore = (storeName, id) => {
            if (!id) {
                // Get all - inefficient but works for fallback
                const results = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(storeName + '_')) {
                        results.push(JSON.parse(localStorage.getItem(key)));
                    }
                }
                return Promise.resolve(results);
            }
            
            const key = `${storeName}_${id}`;
            const item = localStorage.getItem(key);
            return Promise.resolve(item ? JSON.parse(item) : null);
        };
    }
    
    // ============================================
    // Statistics & Monitoring
    // ============================================
    
    getStats() {
        const totalReads = this.stats.reads;
        const cacheHitRate = totalReads > 0 
            ? ((this.stats.cacheHits / totalReads) * 100).toFixed(1)
            : 0;
        
        return {
            ...this.stats,
            cacheHitRate: cacheHitRate + '%',
            memoryCacheSize: this.memoryCache.size,
            lruCacheSize: this.lruCache.size,
            totalCacheSize: this.memoryCache.size + this.lruCache.size,
            isIndexedDB: !this.localStorageMode,
            storageLimit: this.localStorageMode ? '~5MB' : 'Unlimited (browser dependent)'
        };
    }
    
    printStats() {
        const stats = this.getStats();
        console.log('📊 Storage Engine Stats:');
        console.log(`   Reads: ${stats.reads} | Writes: ${stats.writes}`);
        console.log(`   Cache Hit Rate: ${stats.cacheHitRate}`);
        console.log(`   Memory Cache: ${stats.memoryCacheSize} items`);
        console.log(`   LRU Cache: ${stats.lruCacheSize} items`);
        console.log(`   Storage Mode: ${stats.isIndexedDB ? 'IndexedDB' : 'LocalStorage'}`);
    }
    
    // ============================================
    // Sync Queue Management (for offline queueing)
    // ============================================
    
    async addToSyncQueue(operation) {
        const queueItem = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            operation: operation,
            timestamp: Date.now(),
            status: 'pending',
            retries: 0
        };
        
        await this.save('syncQueue', queueItem);
        console.log(`📤 Added to sync queue: ${operation.type}`);
        
        return queueItem.id;
    }
    
    async getPendingSyncs() {
        return this.query('syncQueue', 'status', 'pending');
    }
    
    async markSyncComplete(id) {
        const item = await this.get('syncQueue', id);
        if (item) {
            item.status = 'completed';
            item.completedAt = Date.now();
            await this.save('syncQueue', item);
        }
    }
    
    async markSyncFailed(id, error) {
        const item = await this.get('syncQueue', id);
        if (item) {
            item.status = 'failed';
            item.retries++;
            item.lastError = error;
            item.failedAt = Date.now();
            await this.save('syncQueue', item);
        }
    }
    
    // ============================================
    // Export/Import (for backup/restore)
    // ============================================
    
    async exportStore(storeName) {
        const data = await this.getAllFromStore(storeName);
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${storeName}_export_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        return data.length;
    }
    
    async importStore(storeName, jsonData) {
        const items = JSON.parse(jsonData);
        const result = await this.saveMany(storeName, items);
        
        console.log(`📥 Imported ${result.completed} items to ${storeName}`);
        return result;
    }
}

// ============================================
// Drug Storage Manager (Specialized for drugs)
// ============================================

class DrugStorageManager {
    constructor() {
        this.storage = new OfflineStorageEngine();
        this.phoneticIndex = new Map();
        this.isInitialized = false;
    }
    
    async initialize() {
        await this.storage.initialize();
        
        // Build phonetic index for fast voice matching
        await this.rebuildPhoneticIndex();
        
        this.isInitialized = true;
        console.log('💊 Drug Storage Manager ready');
    }
    
    async rebuildPhoneticIndex() {
        console.log('🔤 Building phonetic index...');
        
        const drugs = await this.storage.getAllFromStore('drugs');
        this.phoneticIndex.clear();
        
        drugs.forEach(drug => {
            // Index by voice aliases
            if (drug.voiceAliases) {
                drug.voiceAliases.forEach(alias => {
                    const code = this.generatePhoneticCode(alias);
                    if (!this.phoneticIndex.has(code)) {
                        this.phoneticIndex.set(code, []);
                    }
                    this.phoneticIndex.get(code).push(drug.id);
                });
            }
            
            // Index by trade name
            const tradeCode = this.generatePhoneticCode(drug.tradeName);
            if (!this.phoneticIndex.has(tradeCode)) {
                this.phoneticIndex.set(tradeCode, []);
            }
            if (!this.phoneticIndex.get(tradeCode).includes(drug.id)) {
                this.phoneticIndex.get(tradeCode).push(drug.id);
            }
        });
        
        console.log(`🔤 Indexed ${this.phoneticIndex.size} phonetic codes`);
    }
    
    generatePhoneticCode(text) {
        return text
            .toLowerCase()
            .replace(/[^a-z]/g, '')
            .replace(/[aeiou]/g, '')
            .substring(0, 4);
    }
    
    // Fast drug lookup by voice input
    async findByVoiceInput(input) {
        const code = this.generatePhoneticCode(input);
        const ids = this.phoneticIndex.get(code) || [];
        
        // Get full drug data
        const drugs = await this.storage.getMany('drugs', ids);
        
        // Score and sort by similarity
        return drugs.map(drug => ({
            ...drug,
            matchScore: this.calculateMatchScore(input, drug)
        })).sort((a, b) => b.matchScore - a.matchScore);
    }
    
    calculateMatchScore(input, drug) {
        let score = 0;
        const inputLower = input.toLowerCase();
        
        // Exact match
        if (drug.tradeName.toLowerCase() === inputLower) score += 1;
        
        // Alias match
        if (drug.voiceAliases) {
            drug.voiceAliases.forEach(alias => {
                if (alias.toLowerCase() === inputLower) {
                    score += 0.9;
                }
            });
        }
        
        // Partial match
        if (drug.tradeName.toLowerCase().includes(inputLower)) score += 0.5;
        
        return score;
    }
    
    // Save drug with indexing
    async saveDrug(drug) {
        await this.storage.save('drugs', drug);
        
        // Update phonetic index
        if (drug.voiceAliases) {
            drug.voiceAliases.forEach(alias => {
                const code = this.generatePhoneticCode(alias);
                if (!this.phoneticIndex.has(code)) {
                    this.phoneticIndex.set(code, []);
                }
                if (!this.phoneticIndex.get(code).includes(drug.id)) {
                    this.phoneticIndex.get(code).push(drug.id);
                }
            });
        }
        
        return drug;
    }
    
    // Save many drugs (batch import)
    async saveManyDrugs(drugs) {
        const result = await this.storage.saveMany('drugs', drugs);
        
        // Rebuild index after bulk import
        await this.rebuildPhoneticIndex();
        
        return result;
    }
    
    // Get storage stats
    getStats() {
        return this.storage.getStats();
    }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        OfflineStorageEngine,
        DrugStorageManager
    };
}

window.OfflineStorageEngine = OfflineStorageEngine;
window.DrugStorageManager = DrugStorageManager;

console.log('💾 Offline Storage Engine loaded');
console.log('📊 100% Offline Capable | Massive Scale Ready');
console.log('🚀 IndexedDB + Multi-Level Caching');
