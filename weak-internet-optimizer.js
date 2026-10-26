// ============================================
// Weak Internet Optimizer
// Optimized for Egyptian Rural Areas (2G/3G/Edge)
// Minimal Data Consumption | Maximum Reliability
// ============================================

class WeakInternetOptimizer {
    constructor() {
        this.connectionInfo = {
            type: 'unknown',
            downlink: 0,
            rtt: 0,
            saveData: false
        };
        
        this.syncStrategies = {
            '2g': { batchSize: 10, compression: 'high', interval: 300000, priority: 'critical' },
            '3g': { batchSize: 50, compression: 'medium', interval: 120000, priority: 'normal' },
            '4g': { batchSize: 100, compression: 'low', interval: 30000, priority: 'all' },
            'wifi': { batchSize: 200, compression: 'none', interval: 10000, priority: 'all' },
            'offline': { batchSize: 0, compression: 'none', interval: 0, priority: 'none' }
        };
        
        this.dataUsage = {
            totalBytes: 0,
            compressedBytes: 0,
            syncs: 0,
            savings: 0
        };
        
        this.init();
    }
    
    init() {
        this.detectConnection();
        this.setupConnectionMonitoring();
        console.log('🌐 Weak Internet Optimizer initialized');
        console.log(`📊 Optimized for: ${this.connectionInfo.type}`);
    }
    
    // Detect current connection type
    detectConnection() {
        const connection = navigator.connection || 
                          navigator.mozConnection || 
                          navigator.webkitConnection;
        
        if (connection) {
            this.connectionInfo = {
                type: connection.effectiveType || 'unknown',
                downlink: connection.downlink || 0,
                rtt: connection.rtt || 0,
                saveData: connection.saveData || false
            };
        } else {
            // Fallback detection
            this.connectionInfo.type = this.fallbackConnectionDetect();
        }
        
        return this.connectionInfo;
    }
    
    fallbackConnectionDetect() {
        // Use online/offline and rough speed estimation
        if (!navigator.onLine) return 'offline';
        
        // Check if slow connection
        const start = performance.now();
        const testImg = new Image();
        testImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        
        return new Promise((resolve) => {
            testImg.onload = () => {
                const duration = performance.now() - start;
                if (duration > 1000) resolve('2g');
                else if (duration > 500) resolve('3g');
                else resolve('4g');
            };
            testImg.onerror = () => resolve('unknown');
        });
    }
    
    // Setup connection monitoring
    setupConnectionMonitoring() {
        const connection = navigator.connection;
        
        if (connection) {
            connection.addEventListener('change', () => {
                const oldType = this.connectionInfo.type;
                this.detectConnection();
                
                if (oldType !== this.connectionInfo.type) {
                    console.log(`🌐 Connection changed: ${oldType} → ${this.connectionInfo.type}`);
                    this.emit('connectionChanged', this.connectionInfo);
                }
            });
        }
        
        window.addEventListener('online', () => {
            console.log('🌐 Back online');
            this.emit('online');
        });
        
        window.addEventListener('offline', () => {
            console.log('📴 Offline');
            this.connectionInfo.type = 'offline';
            this.emit('offline');
        });
    }
    
    // Get optimal strategy for current connection
    getOptimalStrategy() {
        return this.syncStrategies[this.connectionInfo.type] || this.syncStrategies['3g'];
    }
    
    // Compress data based on connection type
    async compressData(data, level = 'medium') {
        const jsonString = JSON.stringify(data);
        const originalSize = new Blob([jsonString]).size;
        
        // Don't compress if already small or on good connection
        if (originalSize < 1024 || level === 'none') {
            return {
                data: data,
                compressed: false,
                originalSize,
                compressedSize: originalSize,
                ratio: 1
            };
        }
        
        try {
            // Use CompressionStream if available
            if (window.CompressionStream) {
                const cs = new CompressionStream(level === 'high' ? 'gzip' : 'deflate');
                const stream = new Blob([jsonString]).stream().pipeThrough(cs);
                const compressed = await new Response(stream).arrayBuffer();
                
                const compressedSize = compressed.byteLength;
                const ratio = originalSize / compressedSize;
                
                this.trackDataUsage(originalSize, compressedSize);
                
                return {
                    data: compressed,
                    compressed: true,
                    originalSize,
                    compressedSize,
                    ratio,
                    encoding: 'arraybuffer'
                };
            } else {
                // Fallback: use custom compression
                return this.customCompress(data, level);
            }
        } catch (error) {
            console.error('Compression failed:', error);
            return { data, compressed: false, originalSize, compressedSize: originalSize, ratio: 1 };
        }
    }
    
    // Custom compression for older browsers
    customCompress(data, level) {
        const jsonString = JSON.stringify(data);
        const originalSize = jsonString.length;
        
        // Simple deduplication and abbreviation
        let compressed = jsonString;
        
        if (level === 'high') {
            // Remove whitespace and shorten keys
            compressed = compressed
                .replace(/\s+/g, '')
                .replace(/"tradeName"/g, '"t"')
                .replace(/"scientificName"/g, '"s"')
                .replace(/"category"/g, '"c"')
                .replace(/"price"/g, '"p"')
                .replace(/"company"/g, '"m"'); // m for manufacturer
        }
        
        const compressedSize = compressed.length;
        const ratio = originalSize / compressedSize;
        
        this.trackDataUsage(originalSize, compressedSize);
        
        return {
            data: compressed,
            compressed: true,
            originalSize,
            compressedSize,
            ratio,
            encoding: 'string',
            custom: true
        };
    }
    
    // Decompress data
    async decompressData(compressedData, encoding) {
        if (!compressedData.compressed) {
            return compressedData.data;
        }
        
        try {
            if (encoding === 'arraybuffer' && window.DecompressionStream) {
                const ds = new DecompressionStream('gzip');
                const stream = new Blob([compressedData.data]).stream().pipeThrough(ds);
                const text = await new Response(stream).text();
                return JSON.parse(text);
            } else if (compressedData.custom) {
                // Custom decompression
                let decompressed = compressedData.data;
                decompressed = decompressed
                    .replace(/"t":/g, '"tradeName":')
                    .replace(/"s":/g, '"scientificName":')
                    .replace(/"c":/g, '"category":')
                    .replace(/"p":/g, '"price":')
                    .replace(/"m":/g, '"company":');
                return JSON.parse(decompressed);
            } else {
                return JSON.parse(compressedData.data);
            }
        } catch (error) {
            console.error('Decompression failed:', error);
            return null;
        }
    }
    
    // Track data usage
    trackDataUsage(originalBytes, compressedBytes) {
        this.dataUsage.totalBytes += originalBytes;
        this.dataUsage.compressedBytes += compressedBytes;
        this.dataUsage.syncs++;
        this.dataUsage.savings += (originalBytes - compressedBytes);
        
        // Save to localStorage for reporting
        localStorage.setItem('data_usage_stats', JSON.stringify(this.dataUsage));
    }
    
    // Get data savings report
    getSavingsReport() {
        const savingsMB = (this.dataUsage.savings / (1024 * 1024)).toFixed(2);
        const percentage = this.dataUsage.totalBytes > 0 
            ? ((this.dataUsage.savings / this.dataUsage.totalBytes) * 100).toFixed(1)
            : 0;
        
        return {
            totalSyncedMB: (this.dataUsage.totalBytes / (1024 * 1024)).toFixed(2),
            savedMB: savingsMB,
            savingsPercentage: percentage,
            syncCount: this.dataUsage.syncs,
            connectionType: this.connectionInfo.type
        };
    }
    
    // Create delta sync (only changes)
    createDeltaSync(currentData, previousVersion) {
        const changes = [];
        
        currentData.forEach(item => {
            const prev = previousVersion.find(p => p.id === item.id);
            
            if (!prev) {
                // New item
                changes.push({ type: 'add', data: item });
            } else if (this.hasChanges(item, prev)) {
                // Modified item - only send changed fields
                const delta = this.getDelta(item, prev);
                changes.push({ type: 'update', id: item.id, changes: delta });
            }
        });
        
        // Check for deletions
        previousVersion.forEach(prev => {
            if (!currentData.find(c => c.id === prev.id)) {
                changes.push({ type: 'delete', id: prev.id });
            }
        });
        
        return {
            changes,
            changeCount: changes.length,
            isDelta: true,
            baseVersion: previousVersion.length
        };
    }
    
    hasChanges(current, previous) {
        return JSON.stringify(current) !== JSON.stringify(previous);
    }
    
    getDelta(current, previous) {
        const delta = {};
        
        Object.keys(current).forEach(key => {
            if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
                delta[key] = current[key];
            }
        });
        
        return delta;
    }
    
    // Batch multiple requests
    createBatch(requests, maxBatchSize) {
        const batches = [];
        
        for (let i = 0; i < requests.length; i += maxBatchSize) {
            batches.push(requests.slice(i, i + maxBatchSize));
        }
        
        return batches;
    }
    
    // Smart retry with exponential backoff
    async smartRetry(operation, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                console.warn(`Attempt ${attempt} failed:`, error.message);
                
                if (attempt === maxRetries) {
                    throw error;
                }
                
                // Exponential backoff based on connection type
                const delay = this.getRetryDelay(attempt);
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    getRetryDelay(attempt) {
        const baseDelay = this.connectionInfo.type === '2g' ? 10000 : 5000;
        return baseDelay * Math.pow(2, attempt - 1);
    }
    
    // Check if should sync now (based on data saver mode)
    shouldSync() {
        if (!navigator.onLine) return false;
        if (this.connectionInfo.type === 'offline') return false;
        if (this.connectionInfo.saveData) {
            // In data saver mode, only sync critical data
            console.log('📱 Data saver mode - delaying non-critical sync');
            return false;
        }
        return true;
    }
    
    // Get sync priority for current connection
    getSyncPriority(dataType) {
        const strategy = this.getOptimalStrategy();
        
        if (strategy.priority === 'critical') {
            // Only sync prices and critical updates
            return ['price_update', 'critical_alert'].includes(dataType);
        }
        
        if (strategy.priority === 'normal') {
            // Skip large files and non-urgent updates
            return !['image', 'bulk_import', 'report'].includes(dataType);
        }
        
        return true; // Sync all on good connections
    }
    
    // Estimate sync time
    estimateSyncTime(dataSizeBytes) {
        const downlink = this.connectionInfo.downlink; // Mbps
        if (downlink === 0) return Infinity;
        
        // Estimate time in seconds with overhead
        const seconds = (dataSizeBytes * 8) / (downlink * 1024 * 1024) * 1.5;
        return Math.ceil(seconds);
    }
    
    // Show data usage notification (for user awareness)
    showDataUsage() {
        const report = this.getSavingsReport();
        
        if (this.connectionInfo.type === '2g' || this.connectionInfo.type === '3g') {
            console.log(`📊 Data Usage Report:`);
            console.log(`   Total: ${report.totalSyncedMB} MB`);
            console.log(`   Saved: ${report.savedMB} MB (${report.savingsPercentage}%)`);
            console.log(`   Connection: ${this.connectionInfo.type}`);
            
            // Show toast notification if available
            if (window.showToast) {
                window.showToast(`💾 تم توفير ${report.savedMB} ميجابايت من البيانات`, 'info');
            }
        }
    }
    
    // Event emitter
    callbacks = {};
    
    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }
    
    emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(cb => cb(data));
        }
    }
}

// ============================================
// Progressive Sync Manager
// Loads data in chunks for weak internet
// ============================================

class ProgressiveSyncManager {
    constructor(optimizer) {
        this.optimizer = optimizer;
        this.loadingQueue = [];
        this.isLoading = false;
        this.loadedChunks = new Set();
    }
    
    // Load data progressively
    async loadProgressively(url, totalChunks, onChunkLoaded) {
        const chunks = [];
        const strategy = this.optimizer.getOptimalStrategy();
        
        // Calculate chunks to load based on connection
        const chunksPerBatch = this.getChunksPerBatch(strategy);
        
        for (let i = 0; i < totalChunks; i += chunksPerBatch) {
            const batchChunks = [];
            
            for (let j = i; j < Math.min(i + chunksPerBatch, totalChunks); j++) {
                if (!this.loadedChunks.has(j)) {
                    batchChunks.push(this.loadChunk(url, j));
                }
            }
            
            try {
                const results = await Promise.all(batchChunks);
                results.forEach((result, index) => {
                    const chunkIndex = i + index;
                    chunks[chunkIndex] = result;
                    this.loadedChunks.add(chunkIndex);
                    
                    if (onChunkLoaded) {
                        onChunkLoaded(chunkIndex, totalChunks, result);
                    }
                });
                
                // Delay between batches for weak connections
                if (this.optimizer.connectionInfo.type === '2g') {
                    await new Promise(r => setTimeout(r, 1000));
                }
                
            } catch (error) {
                console.error(`Failed to load chunks ${i}-${i + chunksPerBatch}:`, error);
            }
        }
        
        return chunks;
    }
    
    getChunksPerBatch(strategy) {
        switch(strategy.batchSize) {
            case 10: return 1;   // 2G: 1 chunk at a time
            case 50: return 3;   // 3G: 3 chunks
            case 100: return 5;  // 4G: 5 chunks
            default: return 10;  // WiFi: 10 chunks
        }
    }
    
    async loadChunk(url, chunkIndex) {
        const response = await fetch(`${url}?chunk=${chunkIndex}`, {
            headers: {
                'Accept': 'application/json',
                'X-Connection-Type': this.optimizer.connectionInfo.type
            }
        });
        
        if (!response.ok) {
            throw new Error(`Chunk ${chunkIndex} failed: ${response.status}`);
        }
        
        return await response.json();
    }
    
    // Cancel loading
    cancel() {
        this.isLoading = false;
        this.loadingQueue = [];
    }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WeakInternetOptimizer,
        ProgressiveSyncManager
    };
}

window.WeakInternetOptimizer = WeakInternetOptimizer;
window.ProgressiveSyncManager = ProgressiveSyncManager;

console.log('🌐 Weak Internet Optimizer loaded');
console.log('📱 Optimized for Egyptian rural areas (2G/3G/4G)');
console.log('💾 Compression enabled for minimal data usage');
