// ============================================
// Storage Worker Thread
// Offloads heavy operations from main thread
// Ensures 60fps UI stability
// ============================================

// Worker state
const workerState = {
    isReady: false,
    db: null,
    pendingOperations: new Map(),
    operationCounter: 0
};

// Database configuration
const DB_CONFIG = {
    name: 'MegaStorageDB',
    version: 1,
    stores: {
        drugs: { keyPath: 'id', indexes: ['tradeName', 'scientificName', 'category'] },
        inventory: { keyPath: 'id', indexes: ['drugId', 'addedAt'] },
        transactions: { keyPath: 'id', indexes: ['date', 'type'] },
        voiceCache: { keyPath: 'phoneticCode' },
        syncQueue: { keyPath: 'id', indexes: ['timestamp', 'status'] }
    }
};

// ============================================
// Initialize IndexedDB in Worker
// ============================================

async function initializeDB() {
    if (workerState.db) return workerState.db;
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            workerState.db = request.result;
            workerState.isReady = true;
            resolve(request.result);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            for (const [storeName, config] of Object.entries(DB_CONFIG.stores)) {
                if (!db.objectStoreNames.contains(storeName)) {
                    const store = db.createObjectStore(storeName, { 
                        keyPath: config.keyPath,
                        autoIncrement: config.autoIncrement || false
                    });
                    
                    if (config.indexes) {
                        config.indexes.forEach(indexName => {
                            store.createIndex(indexName, indexName, { unique: false });
                        });
                    }
                }
            }
        };
    });
}

// ============================================
// Core Operations
// ============================================

async function saveToStore(storeName, items) {
    const db = await initializeDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const results = { completed: 0, failed: 0 };
        
        // Handle single item or array
        const itemsArray = Array.isArray(items) ? items : [items];
        let processed = 0;
        
        itemsArray.forEach(item => {
            const request = store.put(item);
            
            request.onsuccess = () => {
                results.completed++;
                processed++;
                if (processed === itemsArray.length) {
                    resolve(results);
                }
            };
            
            request.onerror = () => {
                results.failed++;
                processed++;
                console.error('Worker: Failed to save item', item.id);
            };
        });
        
        // Handle empty array
        if (itemsArray.length === 0) {
            resolve(results);
        }
        
        transaction.onerror = () => reject(transaction.error);
    });
}

async function getFromStore(storeName, id) {
    const db = await initializeDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        
        if (id) {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        } else {
            const results = [];
            const request = store.openCursor();
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
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

async function deleteFromStore(storeName, id) {
    const db = await initializeDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(id);
        
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

async function clearStore(storeName) {
    const db = await initializeDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

async function queryByIndex(storeName, indexName, value) {
    const db = await initializeDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const index = store.index(indexName);
        
        const results = [];
        const request = index.openCursor(IDBKeyRange.only(value));
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                results.push(cursor.value);
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        
        request.onerror = () => reject(request.error);
    });
}

async function countItems(storeName) {
    const db = await initializeDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.count();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ============================================
// Heavy Operations (Background Processing)
// ============================================

async function bulkInsert(storeName, items, batchSize = 1000) {
    const db = await initializeDB();
    const results = { completed: 0, failed: 0, batches: 0 };
    
    // Process in batches to avoid blocking
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        await new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            let completed = 0;
            
            batch.forEach(item => {
                const request = store.put(item);
                
                request.onsuccess = () => {
                    completed++;
                    if (completed === batch.length) {
                        results.completed += completed;
                        results.batches++;
                        resolve();
                    }
                };
                
                request.onerror = () => {
                    results.failed++;
                    completed++;
                };
            });
            
            transaction.onerror = () => reject(transaction.error);
        });
        
        // Report progress every batch
        self.postMessage({
            type: 'progress',
            operation: 'bulkInsert',
            progress: Math.round((i / items.length) * 100),
            processed: i + batch.length,
            total: items.length
        });
        
        // Allow event loop to breathe
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    return results;
}

async function buildPhoneticIndex(drugs) {
    const index = new Map();
    
    drugs.forEach((drug, idx) => {
        // Index by voice aliases
        if (drug.voiceAliases) {
            drug.voiceAliases.forEach(alias => {
                const code = generatePhoneticCode(alias);
                if (!index.has(code)) {
                    index.set(code, []);
                }
                if (!index.get(code).includes(drug.id)) {
                    index.get(code).push(drug.id);
                }
            });
        }
        
        // Index by trade name
        const tradeCode = generatePhoneticCode(drug.tradeName);
        if (!index.has(tradeCode)) {
            index.set(tradeCode, []);
        }
        if (!index.get(code).includes(drug.id)) {
            index.get(tradeCode).push(drug.id);
        }
        
        // Report progress every 1000 items
        if (idx % 1000 === 0) {
            self.postMessage({
                type: 'progress',
                operation: 'indexing',
                progress: Math.round((idx / drugs.length) * 100)
            });
        }
    });
    
    // Convert Map to serializable object
    const serializedIndex = {};
    for (const [key, value] of index) {
        serializedIndex[key] = value;
    }
    
    return {
        index: serializedIndex,
        totalCodes: index.size,
        totalDrugs: drugs.length
    };
}

function generatePhoneticCode(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .replace(/[aeiou]/g, '')
        .substring(0, 4);
}

async function fuzzySearch(storeName, field, query, options = {}) {
    const { limit = 10, threshold = 0.6 } = options;
    
    // Get all items from store
    const items = await getFromStore(storeName);
    
    const results = items.map(item => {
        const value = item[field] || '';
        const score = calculateSimilarity(query.toLowerCase(), value.toLowerCase());
        return { item, score };
    }).filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    return results.map(r => ({ ...r.item, _matchScore: r.score }));
}

function calculateSimilarity(a, b) {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    
    const distance = levenshteinDistance(a, b);
    const maxLength = Math.max(a.length, b.length);
    return 1 - (distance / maxLength);
}

function levenshteinDistance(a, b) {
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

async function exportStore(storeName) {
    const items = await getFromStore(storeName);
    return {
        storeName,
        itemCount: items.length,
        data: items
    };
}

async function importStore(storeName, items, batchSize = 1000) {
    return bulkInsert(storeName, items, batchSize);
}

// ============================================
// Message Handler
// ============================================

self.onmessage = async function(e) {
    const { type, id, payload } = e.data;
    
    try {
        let result;
        
        switch(type) {
            case 'init':
                await initializeDB();
                result = { success: true, message: 'Worker initialized' };
                break;
                
            case 'save':
                result = await saveToStore(payload.store, payload.items);
                break;
                
            case 'get':
                result = await getFromStore(payload.store, payload.id);
                break;
                
            case 'delete':
                result = await deleteFromStore(payload.store, payload.id);
                break;
                
            case 'clear':
                result = await clearStore(payload.store);
                break;
                
            case 'query':
                result = await queryByIndex(payload.store, payload.index, payload.value);
                break;
                
            case 'count':
                result = await countItems(payload.store);
                break;
                
            case 'bulkInsert':
                result = await bulkInsert(payload.store, payload.items, payload.batchSize);
                break;
                
            case 'buildIndex':
                result = await buildPhoneticIndex(payload.drugs);
                break;
                
            case 'search':
                result = await fuzzySearch(payload.store, payload.field, payload.query, payload.options);
                break;
                
            case 'export':
                result = await exportStore(payload.store);
                break;
                
            case 'import':
                result = await importStore(payload.store, payload.items, payload.batchSize);
                break;
                
            default:
                throw new Error(`Unknown operation: ${type}`);
        }
        
        // Send success response
        self.postMessage({
            type: 'result',
            id,
            success: true,
            result
        });
        
    } catch (error) {
        // Send error response
        self.postMessage({
            type: 'result',
            id,
            success: false,
            error: error.message
        });
    }
};

// ============================================
// Keep Alive
// ============================================

// Prevent worker from being terminated during long operations
setInterval(() => {
    self.postMessage({ type: 'ping' });
}, 30000);

console.log('🧵 Storage Worker initialized');
console.log('⚡ Ready for background processing');
