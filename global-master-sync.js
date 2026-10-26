// ============================================
// Global Master Sync Engine
// Instant Updates Across All Warehouses
// Real-time Egyptian Drug Encyclopedia Synchronization
// ============================================

class GlobalMasterSync {
    constructor(config = {}) {
        this.config = {
            syncEndpoint: config.syncEndpoint || '/api/sync',
            websocketUrl: config.websocketUrl || null,
            batchSize: config.batchSize || 100,
            compressionEnabled: config.compressionEnabled !== false,
            ...config
        };
        
        this.state = {
            lastSyncVersion: parseInt(localStorage.getItem('global_sync_version') || '0'),
            isConnected: false,
            syncInProgress: false,
            pendingChanges: [],
            subscribedChannels: new Set()
        };
        
        this.websocket = null;
        this.syncInterval = null;
        this.callbacks = {};
        
        // Connection types for weak internet optimization
        this.connectionType = 'unknown';
        this.bandwidthEstimate = 0;
    }
    
    // Initialize global sync
    async initialize() {
        console.log('🌍 Global Master Sync initializing...');
        
        // Detect connection type
        this.detectConnectionType();
        
        // Setup network monitoring
        this.setupNetworkMonitoring();
        
        // Try WebSocket first (real-time), fallback to polling
        if (this.config.websocketUrl) {
            await this.connectWebSocket();
        } else {
            this.startPollingSync();
        }
        
        console.log('✅ Global Master Sync ready');
        console.log(`📡 Connection: ${this.connectionType}`);
    }
    
    // Detect connection type for optimization
    detectConnectionType() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        
        if (connection) {
            this.connectionType = connection.effectiveType || 'unknown';
            this.bandwidthEstimate = connection.downlink || 0;
            
            connection.addEventListener('change', () => {
                this.connectionType = connection.effectiveType;
                this.bandwidthEstimate = connection.downlink;
                console.log(`🌐 Connection changed: ${this.connectionType} (${this.bandwidthEstimate} Mbps)`);
            });
        }
    }
    
    // WebSocket connection for real-time sync
    async connectWebSocket() {
        try {
            this.websocket = new WebSocket(this.config.websocketUrl);
            
            this.websocket.onopen = () => {
                console.log('🌐 WebSocket connected - Real-time sync active');
                this.state.isConnected = true;
                this.emit('connected', { type: 'websocket' });
                
                // Subscribe to global updates
                this.subscribeToChannel('master_drugs');
                this.subscribeToChannel('price_updates');
            };
            
            this.websocket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                this.handleServerMessage(message);
            };
            
            this.websocket.onclose = () => {
                console.log('🌐 WebSocket closed - Falling back to polling');
                this.state.isConnected = false;
                this.startPollingSync();
            };
            
            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.state.isConnected = false;
            };
            
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.startPollingSync();
        }
    }
    
    // Subscribe to update channel
    subscribeToChannel(channel) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({
                action: 'subscribe',
                channel: channel
            }));
            this.state.subscribedChannels.add(channel);
        }
    }
    
    // Handle incoming server messages
    handleServerMessage(message) {
        switch(message.type) {
            case 'master_drug_update':
                this.handleMasterDrugUpdate(message.data);
                break;
            case 'price_update':
                this.handlePriceUpdate(message.data);
                break;
            case 'bulk_update':
                this.handleBulkUpdate(message.data);
                break;
            case 'sync_ack':
                this.handleSyncAck(message);
                break;
            default:
                console.log('Unknown message type:', message.type);
        }
    }
    
    // Handle master drug update (new or modified drug)
    handleMasterDrugUpdate(data) {
        console.log('📦 Master drug update received:', data.tradeName);
        
        // Update local storage
        this.updateLocalMasterDrug(data);
        
        // Emit to listeners
        this.emit('master_drug_updated', data);
        
        // Show notification if UI available
        this.showUpdateNotification('drug', data.tradeName);
    }
    
    // Handle price update
    handlePriceUpdate(data) {
        console.log('💰 Price update received:', data.tradeName, '→', data.newPrice);
        
        // Update local price cache
        this.updateLocalPrice(data);
        
        // Emit to listeners
        this.emit('price_updated', data);
        
        // Show notification
        this.showUpdateNotification('price', `${data.tradeName}: ${data.newPrice} ج.م`);
    }
    
    // Handle bulk update (multiple changes)
    handleBulkUpdate(data) {
        console.log(`📦 Bulk update: ${data.changes.length} changes`);
        
        data.changes.forEach(change => {
            if (change.type === 'drug') {
                this.updateLocalMasterDrug(change.data);
            } else if (change.type === 'price') {
                this.updateLocalPrice(change.data);
            }
        });
        
        this.emit('bulk_updated', data);
    }
    
    // Update local master drug storage
    updateLocalMasterDrug(drug) {
        let drugs = JSON.parse(localStorage.getItem('master_drugs') || '[]');
        
        // Find and update or add
        const existingIndex = drugs.findIndex(d => d.id === drug.id);
        if (existingIndex >= 0) {
            drugs[existingIndex] = { ...drugs[existingIndex], ...drug, updatedAt: Date.now() };
        } else {
            drugs.push({ ...drug, createdAt: Date.now() });
        }
        
        localStorage.setItem('master_drugs', JSON.stringify(drugs));
        localStorage.setItem('master_drugs_version', drug.version.toString());
        
        this.state.lastSyncVersion = drug.version;
    }
    
    // Update local price
    updateLocalPrice(priceData) {
        const prices = JSON.parse(localStorage.getItem('price_cache') || '{}');
        prices[priceData.drugId] = {
            price: priceData.newPrice,
            updatedAt: Date.now(),
            source: priceData.source
        };
        localStorage.setItem('price_cache', JSON.stringify(prices));
    }
    
    // Start polling sync (fallback for weak internet)
    startPollingSync() {
        console.log('🔄 Starting polling sync (WebSocket unavailable)');
        
        // Determine polling interval based on connection type
        const interval = this.getOptimalPollingInterval();
        
        this.syncInterval = setInterval(() => {
            if (navigator.onLine) {
                this.performPollingSync();
            }
        }, interval);
    }
    
    // Get optimal polling interval based on connection
    getOptimalPollingInterval() {
        switch(this.connectionType) {
            case '2g': return 5 * 60 * 1000; // 5 minutes (save data)
            case '3g': return 2 * 60 * 1000; // 2 minutes
            case '4g': return 1 * 60 * 1000; // 1 minute
            default: return 30 * 1000; // 30 seconds (WiFi)
        }
    }
    
    // Perform polling sync
    async performPollingSync() {
        if (this.state.syncInProgress) return;
        
        this.state.syncInProgress = true;
        
        try {
            const response = await fetch(
                `${this.config.syncEndpoint}/check?version=${this.state.lastSyncVersion}&connection=${this.connectionType}`,
                {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Client-Connection': this.connectionType
                    }
                }
            );
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            if (data.hasUpdates) {
                // Apply updates based on connection type
                if (this.connectionType === '2g' || data.changes.length > this.config.batchSize) {
                    // For weak internet, get compressed delta
                    await this.fetchCompressedDelta(data.deltaUrl);
                } else {
                    // Apply changes directly
                    this.handleBulkUpdate({ changes: data.changes });
                }
                
                this.state.lastSyncVersion = data.latestVersion;
                localStorage.setItem('global_sync_version', data.latestVersion.toString());
                
                this.emit('sync_completed', {
                    changesCount: data.changes.length,
                    version: data.latestVersion
                });
            }
            
        } catch (error) {
            console.error('Polling sync failed:', error);
            this.emit('sync_error', error);
        } finally {
            this.state.syncInProgress = false;
        }
    }
    
    // Fetch compressed delta for weak internet
    async fetchCompressedDelta(deltaUrl) {
        try {
            const response = await fetch(deltaUrl, {
                headers: {
                    'Accept-Encoding': 'gzip, brotli'
                }
            });
            
            const compressed = await response.arrayBuffer();
            
            // Decompress (using CompressionStream API if available)
            if (window.DecompressionStream) {
                const ds = new DecompressionStream('gzip');
                const decompressed = await new Response(compressed).body.pipeThrough(ds).text();
                const data = JSON.parse(decompressed);
                this.handleBulkUpdate(data);
            } else {
                // Fallback: server sends uncompressed for old browsers
                const text = await response.text();
                const data = JSON.parse(text);
                this.handleBulkUpdate(data);
            }
            
        } catch (error) {
            console.error('Failed to fetch compressed delta:', error);
        }
    }
    
    // Request full sync (for new warehouse or after long offline period)
    async requestFullSync() {
        console.log('📦 Requesting full master drug sync...');
        
        try {
            const response = await fetch(`${this.config.syncEndpoint}/full`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentVersion: this.state.lastSyncVersion,
                    connectionType: this.connectionType,
                    compression: this.connectionType === '2g' ? 'high' : 'normal'
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            // Replace local storage with full data
            localStorage.setItem('master_drugs', JSON.stringify(data.drugs));
            localStorage.setItem('master_drugs_version', data.version.toString());
            this.state.lastSyncVersion = data.version;
            
            this.emit('full_sync_completed', data);
            
            return data;
            
        } catch (error) {
            console.error('Full sync failed:', error);
            this.emit('sync_error', error);
            throw error;
        }
    }
    
    // Push local changes to server (when warehouse adds custom data)
    async pushChanges(changes) {
        if (!navigator.onLine) {
            // Queue for later
            this.queueChanges(changes);
            return { queued: true };
        }
        
        try {
            const response = await fetch(`${this.config.syncEndpoint}/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    changes,
                    timestamp: Date.now(),
                    source: 'warehouse_client'
                })
            });
            
            return await response.json();
            
        } catch (error) {
            console.error('Push failed:', error);
            this.queueChanges(changes);
            throw error;
        }
    }
    
    // Queue changes for later sync
    queueChanges(changes) {
        const queue = JSON.parse(localStorage.getItem('sync_queue') || '[]');
        queue.push(...changes.map(c => ({ ...c, queuedAt: Date.now() })));
        localStorage.setItem('sync_queue', JSON.stringify(queue));
        
        this.state.pendingChanges = queue;
    }
    
    // Process pending changes when back online
    async processPendingChanges() {
        const queue = JSON.parse(localStorage.getItem('sync_queue') || '[]');
        if (queue.length === 0) return;
        
        console.log(`🔄 Processing ${queue.length} pending changes...`);
        
        try {
            const response = await fetch(`${this.config.syncEndpoint}/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    changes: queue,
                    batch: true
                })
            });
            
            if (response.ok) {
                localStorage.removeItem('sync_queue');
                this.state.pendingChanges = [];
                console.log('✅ Pending changes synced');
            }
            
        } catch (error) {
            console.error('Failed to process pending changes:', error);
        }
    }
    
    // Show update notification
    showUpdateNotification(type, message) {
        // Check if browser supports notifications
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('الموسوعة الدوائية المصرية', {
                body: type === 'price' ? `💰 تحديث سعر: ${message}` : `📦 صنف جديد: ${message}`,
                icon: '/icon.png'
            });
        }
        
        // Also log to console
        console.log(`🔔 ${type === 'price' ? 'Price' : 'Drug'} update: ${message}`);
    }
    
    // Setup network monitoring
    setupNetworkMonitoring() {
        window.addEventListener('online', () => {
            console.log('🌐 Back online - Processing pending changes');
            this.processPendingChanges();
            
            // Reconnect WebSocket if configured
            if (this.config.websocketUrl) {
                this.connectWebSocket();
            }
        });
        
        window.addEventListener('offline', () => {
            console.log('📴 Offline mode - Changes will be queued');
        });
    }
    
    // Handle sync acknowledgment from server
    handleSyncAck(message) {
        console.log('✅ Sync acknowledged by server:', message.syncId);
    }
    
    // Event system
    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }
    
    emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`Callback error for ${event}:`, e);
                }
            });
        }
    }
    
    // Get current master drugs
    getMasterDrugs() {
        return JSON.parse(localStorage.getItem('master_drugs') || '[]');
    }
    
    // Get cached price
    getCachedPrice(drugId) {
        const prices = JSON.parse(localStorage.getItem('price_cache') || '{}');
        const cached = prices[drugId];
        
        // Check if cache is still valid (24 hours)
        if (cached && (Date.now() - cached.updatedAt) < 24 * 60 * 60 * 1000) {
            return cached.price;
        }
        
        return null;
    }
    
    // Destroy and cleanup
    destroy() {
        if (this.websocket) {
            this.websocket.close();
        }
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
    }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GlobalMasterSync };
}

window.GlobalMasterSync = GlobalMasterSync;

console.log('🌍 Global Master Sync Engine loaded');
console.log('📡 Real-time sync across all Egyptian warehouses');
console.log('💾 Weak internet optimized with compression');
