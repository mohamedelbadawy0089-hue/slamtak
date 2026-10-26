/**
 * Drug Data Synchronizer
 * نظام مزامنة بيانات الأدوية المصرية
 * 
 * Features:
 * - Automatic sync from GitHub sources
 * - Change detection with hash comparison
 * - Priority for Egyptian Drug Authority prices
 * - Supabase master_drugs table sync
 * - Offline IndexedDB caching
 */

class DrugDataSynchronizer {
    constructor() {
        this.CONFIG = {
            SOURCES: {
                CSV: {
                    url: 'https://raw.githubusercontent.com/Seifeldeen/Egyptian-Medicines-Dataset/master/output/egyptian_medicines.csv',
                    name: 'Seifeldeen CSV',
                    priority: 2,
                    type: 'csv'
                },
                JSON: {
                    url: 'https://raw.githubusercontent.com/mohammad-shahin/egypt-drugs-database/master/data/all-drugs.json',
                    name: 'Mohammad Shahin JSON',
                    priority: 1,
                    type: 'json'
                }
            },
            DB_NAME: 'DrugSyncDB',
            STORES: {
                MEDICINES: 'medicines',
                SYNC_META: 'syncMeta',
                PENDING_SYNC: 'pendingSync',
                DATA_HASHES: 'dataHashes'
            },
            SUPABASE_TABLE: 'master_drugs',           // Reference data from GitHub sources
            WAREHOUSE_INVENTORY_TABLE: 'warehouse_inventory',  // Per-warehouse inventory
            SYNC_INTERVAL: 12 * 60 * 60 * 1000, // Check every 12 hours
            BACKGROUND_SYNC_INTERVAL: 12 * 60 * 60 * 1000, // 12 hours for continuous sync
            EGYPTIAN_DRUG_AUTHORITY_KEYWORDS: [
                'هيئة الدواء',
                'المصرية',
                'EDA',
                'Egyptian Drug Authority',
                'وزارة الصحة',
                'المجلس القومي'
            ]
        };

        this.db = null;
        this.supabaseClient = null;
        this.syncCallbacks = [];
        this.isSyncing = false;
        this.backgroundSyncInterval = null;
        this.currentWarehouseId = null;
    }

    // ============================================
    // Initialization
    // ============================================
    
    async initialize(supabaseClient = null, warehouseId = null) {
        console.log('🚀 Initializing Drug Data Synchronizer...');
        
        this.supabaseClient = supabaseClient || window.supabaseClient || null;
        this.currentWarehouseId = warehouseId || this.getStoredWarehouseId();
        
        await this.initIndexedDB();
        await this.ensureMasterDrugsTable();
        
        // Start continuous background sync
        this.startContinuousBackgroundSync();
        
        console.log('✅ Synchronizer initialized (Warehouse:', this.currentWarehouseId || 'None', ')');
        return this;
    }

    getStoredWarehouseId() {
        return localStorage.getItem('currentWarehouseId') || null;
    }

    setWarehouseId(warehouseId) {
        this.currentWarehouseId = warehouseId;
        localStorage.setItem('currentWarehouseId', warehouseId);
        console.log('🏭 Warehouse ID set:', warehouseId);
    }

    // ============================================
    // Continuous Background Sync (Every 12 Hours)
    // ============================================
    
    startContinuousBackgroundSync() {
        // Clear existing interval
        if (this.backgroundSyncInterval) {
            clearInterval(this.backgroundSyncInterval);
        }
        
        console.log('🔄 Starting continuous background sync (12h interval)...');
        
        // Immediate check on startup (after 5 seconds)
        setTimeout(() => {
            this.performBackgroundSync();
        }, 5000);
        
        // Set up 12-hour interval
        this.backgroundSyncInterval = setInterval(() => {
            console.log('⏰ 12-hour sync triggered');
            this.performBackgroundSync();
        }, this.CONFIG.BACKGROUND_SYNC_INTERVAL);
        
        // Also set up page visibility check for resuming
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.checkIfSyncNeeded();
            }
        });
    }

    async performBackgroundSync() {
        console.log('🌙 Performing background sync...');
        
        try {
            // Check for updates without forcing
            const result = await this.performSync({ silent: true });
            
            if (result.status === 'completed' && result.medicines?.length > 0) {
                console.log(`✅ Background sync complete: ${result.medicines.length} medicines updated`);
                
                // Notify callbacks silently
                this.notifyCallbacks('background_sync_complete', {
                    count: result.medicines.length,
                    timestamp: new Date()
                });
            } else if (result.status === 'up_to_date') {
                console.log('✓ Background check: Data is up to date');
            }
            
            return result;
        } catch (error) {
            console.error('❌ Background sync error:', error);
            return { status: 'error', error: error.message };
        }
    }

    async checkIfSyncNeeded() {
        const lastSync = await this.getLastSyncTime();
        const timeSinceSync = Date.now() - lastSync;
        
        // If more than 12 hours since last sync
        if (timeSinceSync >= this.CONFIG.BACKGROUND_SYNC_INTERVAL) {
            console.log('⚠️ Sync overdue, triggering background sync...');
            return this.performBackgroundSync();
        }
    }

    getLastSyncTime() {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.SYNC_META], 'readonly');
            const store = transaction.objectStore(this.CONFIG.STORES.SYNC_META);
            const request = store.get('lastSync');
            
            request.onsuccess = () => {
                resolve(request.result?.lastSync || 0);
            };
            
            request.onerror = () => resolve(0);
        });
    }

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.CONFIG.DB_NAME, 1);
            
            request.onerror = () => reject(request.error);
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('✅ IndexedDB initialized');
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Medicines store
                if (!db.objectStoreNames.contains(this.CONFIG.STORES.MEDICINES)) {
                    const store = db.createObjectStore(this.CONFIG.STORES.MEDICINES, { keyPath: 'id' });
                    store.createIndex('tradeName', 'tradeName', { unique: false });
                    store.createIndex('scientificName', 'scientificName', { unique: false });
                    store.createIndex('lastUpdated', 'lastUpdated', { unique: false });
                    store.createIndex('source', 'source', { unique: false });
                }
                
                // Sync metadata store
                if (!db.objectStoreNames.contains(this.CONFIG.STORES.SYNC_META)) {
                    db.createObjectStore(this.CONFIG.STORES.SYNC_META, { keyPath: 'id' });
                }
                
                // Pending sync queue
                if (!db.objectStoreNames.contains(this.CONFIG.STORES.PENDING_SYNC)) {
                    db.createObjectStore(this.CONFIG.STORES.PENDING_SYNC, { keyPath: 'id', autoIncrement: true });
                }
                
                // Data hashes for change detection
                if (!db.objectStoreNames.contains(this.CONFIG.STORES.DATA_HASHES)) {
                    db.createObjectStore(this.CONFIG.STORES.DATA_HASHES, { keyPath: 'source' });
                }
            };
        });
    }

    // ============================================
    // Hash & Change Detection
    // ============================================
    
    async calculateContentHash(content) {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async getStoredHash(sourceKey) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.DATA_HASHES], 'readonly');
            const store = transaction.objectStore(this.CONFIG.STORES.DATA_HASHES);
            const request = store.get(sourceKey);
            
            request.onsuccess = () => {
                resolve(request.result?.hash || null);
            };
            
            request.onerror = () => resolve(null);
        });
    }

    async saveHash(sourceKey, hash, metadata = {}) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.DATA_HASHES], 'readwrite');
            const store = transaction.objectStore(this.CONFIG.STORES.DATA_HASHES);
            
            store.put({
                source: sourceKey,
                hash: hash,
                timestamp: Date.now(),
                ...metadata
            });
            
            transaction.oncomplete = () => resolve();
        });
    }

    // ============================================
    // Data Fetching with ETag Support
    // ============================================
    
    async fetchWithETag(url, storedETag = null) {
        const headers = {};
        if (storedETag) {
            headers['If-None-Match'] = storedETag;
        }
        
        try {
            const response = await fetch(url, { headers });
            
            if (response.status === 304) {
                return { changed: false, data: null, etag: storedETag };
            }
            
            const newETag = response.headers.get('ETag') || response.headers.get('Last-Modified');
            const content = await response.text();
            
            return { changed: true, data: content, etag: newETag };
        } catch (error) {
            console.error(`❌ Fetch error for ${url}:`, error);
            return { changed: false, data: null, etag: null, error };
        }
    }

    async checkForUpdates() {
        console.log('🔍 Checking for data updates...');
        
        const updates = {
            hasUpdates: false,
            sources: {}
        };
        
        for (const [key, source] of Object.entries(this.CONFIG.SOURCES)) {
            console.log(`📡 Checking ${source.name}...`);
            
            const storedHash = await this.getStoredHash(key);
            const result = await this.fetchWithETag(source.url);
            
            if (result.error) {
                console.warn(`⚠️ Could not check ${source.name}:`, result.error.message);
                continue;
            }
            
            if (result.changed && result.data) {
                const newHash = await this.calculateContentHash(result.data);
                
                if (newHash !== storedHash) {
                    console.log(`✅ ${source.name} has updates!`);
                    updates.hasUpdates = true;
                    updates.sources[key] = {
                        source: source,
                        data: result.data,
                        hash: newHash,
                        etag: result.etag
                    };
                } else {
                    console.log(`ℹ️ ${source.name} unchanged (hash match)`);
                }
            } else {
                console.log(`ℹ️ ${source.name} unchanged (304 Not Modified)`);
            }
        }
        
        return updates;
    }

    // ============================================
    // checkUpdates() - Compare Local vs GitHub & Update Immediately
    // ============================================
    
    async checkUpdates(options = {}) {
        const { 
            autoUpdate = true,        // Update IndexedDB immediately if newer
            silent = false,            // Don't show notifications
            onProgress = null         // Callback for progress updates
        } = options;
        
        console.log('🔍 checkUpdates() - Comparing local data with GitHub sources...');
        
        if (!silent) {
            this.notifyCallbacks('check_started', { message: 'جاري التحقق من التحديثات...' });
        }
        
        const results = {
            updated: false,
            sourcesChecked: 0,
            sourcesUpdated: 0,
            medicinesUpdated: 0,
            errors: []
        };
        
        const sourcesToUpdate = {};
        
        for (const [key, source] of Object.entries(this.CONFIG.SOURCES)) {
            results.sourcesChecked++;
            
            if (onProgress) {
                onProgress({ 
                    phase: 'checking', 
                    source: source.name, 
                    progress: (results.sourcesChecked / Object.keys(this.CONFIG.SOURCES).length) * 100 
                });
            }
            
            try {
                // Get stored metadata
                const storedMeta = await this.getSourceMetadata(key);
                const storedDate = storedMeta?.lastModified ? new Date(storedMeta.lastModified) : null;
                
                // Fetch with HEAD request first to check date
                const headResponse = await this.fetchSourceMetadata(source.url);
                
                if (headResponse.error) {
                    console.warn(`⚠️ Could not check ${source.name}:`, headResponse.error);
                    results.errors.push({ source: source.name, error: headResponse.error });
                    continue;
                }
                
                const remoteDate = headResponse.lastModified ? new Date(headResponse.lastModified) : null;
                const remoteETag = headResponse.etag;
                
                console.log(`📅 ${source.name}:`, {
                    local: storedDate?.toISOString() || 'N/A',
                    remote: remoteDate?.toISOString() || 'N/A'
                });
                
                // Determine if update is needed
                let needsUpdate = false;
                
                if (!storedDate && remoteDate) {
                    // No local data, fetch remote
                    needsUpdate = true;
                    console.log(`📥 ${source.name}: No local data, will fetch`);
                } else if (remoteDate && storedDate) {
                    // Compare dates
                    if (remoteDate > storedDate) {
                        needsUpdate = true;
                        console.log(`🔄 ${source.name}: Remote is newer (${remoteDate.toISOString()} > ${storedDate.toISOString()})`);
                    } else if (remoteETag && remoteETag !== storedMeta?.etag) {
                        // ETag changed even if date is same
                        needsUpdate = true;
                        console.log(`🔄 ${source.name}: ETag changed`);
                    }
                }
                
                if (needsUpdate) {
                    // Fetch full data
                    const fetchResult = await this.fetchWithETag(source.url);
                    
                    if (fetchResult.changed && fetchResult.data) {
                        const newHash = await this.calculateContentHash(fetchResult.data);
                        
                        if (newHash !== storedMeta?.hash) {
                            sourcesToUpdate[key] = {
                                source: source,
                                data: fetchResult.data,
                                hash: newHash,
                                etag: fetchResult.etag || remoteETag,
                                lastModified: headResponse.lastModified
                            };
                            results.sourcesUpdated++;
                        }
                    }
                } else {
                    console.log(`✅ ${source.name}: Up to date`);
                }
                
            } catch (error) {
                console.error(`❌ Error checking ${source.name}:`, error);
                results.errors.push({ source: source.name, error: error.message });
            }
        }
        
        // If updates found and autoUpdate enabled, apply immediately
        if (results.sourcesUpdated > 0 && autoUpdate) {
            console.log(`🔄 Applying ${results.sourcesUpdated} source updates...`);
            
            if (onProgress) {
                onProgress({ phase: 'updating', message: 'جاري تحديث البيانات...' });
            }
            
            try {
                // Merge and save
                const mergedMedicines = this.mergeMedicines(sourcesToUpdate);
                results.medicinesUpdated = mergedMedicines.length;
                
                // Save to IndexedDB
                await this.saveMedicinesToIndexedDB(mergedMedicines);
                
                // Save source metadata
                for (const [key, data] of Object.entries(sourcesToUpdate)) {
                    await this.saveSourceMetadata(key, {
                        hash: data.hash,
                        etag: data.etag,
                        lastModified: data.lastModified,
                        lastChecked: new Date().toISOString()
                    });
                }
                
                results.updated = true;
                results.timestamp = new Date().toISOString();
                
                // Sync to master_drugs table if connected (reference data)
                if (this.supabaseClient) {
                    const syncResult = await this.syncToMasterDrugs(mergedMedicines);
                    results.supabaseResult = syncResult;
                }
                
                // Notify
                if (!silent) {
                    this.notifyCallbacks('update_complete', {
                        medicinesUpdated: results.medicinesUpdated,
                        sourcesUpdated: results.sourcesUpdated,
                        message: `تم تحديث ${results.medicinesUpdated} منتج من ${results.sourcesUpdated} مصدر`
                    });
                }
                
                console.log(`✅ checkUpdates() complete: ${results.medicinesUpdated} medicines updated`);
                
            } catch (error) {
                console.error('❌ Error applying updates:', error);
                results.errors.push({ phase: 'apply', error: error.message });
                
                if (!silent) {
                    this.notifyCallbacks('update_error', { error: error.message });
                }
            }
        } else {
            console.log('✅ All sources are up to date');
            
            if (!silent) {
                this.notifyCallbacks('up_to_date', { message: 'البيانات محدثة' });
            }
        }
        
        return results;
    }
    
    // Helper: Fetch only metadata (HEAD request)
    async fetchSourceMetadata(url) {
        try {
            const response = await fetch(url, { method: 'HEAD' });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return {
                lastModified: response.headers.get('Last-Modified'),
                etag: response.headers.get('ETag'),
                contentLength: response.headers.get('Content-Length'),
                contentType: response.headers.get('Content-Type'),
                error: null
            };
        } catch (error) {
            return {
                lastModified: null,
                etag: null,
                error: error.message
            };
        }
    }
    
    // Helper: Get stored source metadata
    async getSourceMetadata(sourceKey) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.DATA_HASHES], 'readonly');
            const store = transaction.objectStore(this.CONFIG.STORES.DATA_HASHES);
            const request = store.get(sourceKey);
            
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            
            request.onerror = () => resolve(null);
        });
    }
    
    // Helper: Save source metadata
    async saveSourceMetadata(sourceKey, metadata) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.DATA_HASHES], 'readwrite');
            const store = transaction.objectStore(this.CONFIG.STORES.DATA_HASHES);
            
            const data = {
                source: sourceKey,
                ...metadata,
                updatedAt: Date.now()
            };
            
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    // Helper: Save medicines to IndexedDB
    async saveMedicinesToIndexedDB(medicines) {
        console.log(`💾 Saving ${medicines.length} medicines to IndexedDB...`);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.MEDICINES], 'readwrite');
            const store = transaction.objectStore(this.CONFIG.STORES.MEDICINES);
            
            let saved = 0;
            
            for (const med of medicines) {
                const request = store.put(med);
                request.onsuccess = () => saved++;
            }
            
            transaction.oncomplete = () => {
                console.log(`✅ Saved ${saved} medicines to IndexedDB`);
                resolve(saved);
            };
            
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // ============================================
    // Data Parsing & Normalization
    // ============================================
    
    parseCSV(csvText) {
        const lines = csvText.split('\n');
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        const medicines = [];
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            const values = lines[i].split(',');
            const med = {};
            
            headers.forEach((header, index) => {
                med[header] = values[index]?.trim() || '';
            });
            
            // Extract fields with flexible column names
            const tradeName = med['trade name'] || med['tradename'] || med['trade_name'] || '';
            const scientificName = med['scientific name'] || med['scientificname'] || med['scientific_name'] || '';
            const price = parseFloat(med['price'] || med['current price'] || med['current_price'] || 0);
            const company = med['company'] || med['manufacturer'] || '';
            
            // Check if from Egyptian Drug Authority
            const isEDA = this.isEgyptianDrugAuthoritySource(med, company);
            
            if (tradeName) {
                medicines.push({
                    tradeName: tradeName.trim(),
                    scientificName: scientificName.trim(),
                    price: price,
                    company: company.trim(),
                    source: 'Seifeldeen CSV',
                    isOfficialPrice: isEDA,
                    lastUpdated: new Date().toISOString()
                });
            }
        }
        
        return medicines;
    }

    parseJSON(jsonText) {
        try {
            const data = JSON.parse(jsonText);
            const medicines = data.drugs || data.medicines || data.data || [];
            
            return medicines.map(med => {
                const tradeName = med.tradeName || med.trade_name || med['Trade Name'] || med.name || '';
                const scientificName = med.scientificName || med.scientific_name || med['Scientific Name'] || med.activeIngredient || '';
                const price = parseFloat(med.price || med.currentPrice || med['Current Price'] || 0);
                const company = med.company || med.manufacturer || med.Manufacturer || '';
                
                const isEDA = this.isEgyptianDrugAuthoritySource(med, company);
                
                return {
                    tradeName: tradeName.trim(),
                    scientificName: scientificName.trim(),
                    price: price,
                    company: company.trim(),
                    source: 'Mohammad Shahin JSON',
                    isOfficialPrice: isEDA,
                    lastUpdated: new Date().toISOString()
                };
            }).filter(med => med.tradeName);
        } catch (error) {
            console.error('❌ JSON parse error:', error);
            return [];
        }
    }

    isEgyptianDrugAuthoritySource(med, company) {
        const text = JSON.stringify(med).toLowerCase();
        const companyLower = company.toLowerCase();
        
        return this.CONFIG.EGYPTIAN_DRUG_AUTHORITY_KEYWORDS.some(keyword => 
            text.includes(keyword.toLowerCase()) || 
            companyLower.includes(keyword.toLowerCase())
        );
    }

    // ============================================
    // Data Merging with Priority
    // ============================================
    
    mergeMedicines(sourcesData) {
        console.log('🔄 Merging medicine data sources...');
        
        const merged = new Map();
        
        // Process each source by priority
        const sortedSources = Object.entries(sourcesData).sort((a, b) => {
            return a[1].source.priority - b[1].source.priority;
        });
        
        for (const [key, sourceData] of sortedSources) {
            const medicines = sourceData.source.type === 'csv' 
                ? this.parseCSV(sourceData.data)
                : this.parseJSON(sourceData.data);
            
            console.log(`📊 ${sourceData.source.name}: ${medicines.length} medicines`);
            
            for (const med of medicines) {
                const key = med.tradeName.toLowerCase().trim();
                if (!key) continue;
                
                if (merged.has(key)) {
                    const existing = merged.get(key);
                    
                    // Priority: Egyptian Drug Authority prices
                    if (med.isOfficialPrice && !existing.isOfficialPrice) {
                        existing.price = med.price;
                        existing.isOfficialPrice = true;
                        existing.officialSource = med.source;
                    }
                    // Otherwise, prefer non-zero prices
                    else if (med.price > 0 && (existing.price === 0 || !existing.isOfficialPrice)) {
                        existing.price = med.price;
                    }
                    
                    // Merge other info
                    if (!existing.scientificName) existing.scientificName = med.scientificName;
                    if (!existing.company) existing.company = med.company;
                    existing.lastUpdated = new Date().toISOString();
                    existing.dataSources = [...(existing.dataSources || []), med.source];
                } else {
                    med.dataSources = [med.source];
                    med.id = this.generateId(key);
                    merged.set(key, med);
                }
            }
        }
        
        const result = Array.from(merged.values());
        console.log(`✅ Merged: ${result.length} unique medicines`);
        
        // Count official prices
        const officialCount = result.filter(m => m.isOfficialPrice).length;
        console.log(`🏛️ Egyptian Drug Authority prices: ${officialCount}`);
        
        return result;
    }

    generateId(tradeName) {
        // Generate consistent ID from trade name
        return 'med_' + btoa(tradeName.toLowerCase()).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
    }

    // ============================================
    // Supabase Integration
    // ============================================
    
    async ensureMasterDrugsTable() {
        if (!this.supabaseClient) {
            console.warn('⚠️ No Supabase client - skipping table check');
            return;
        }
        
        try {
            // Check master_drugs table (reference data from GitHub)
            const { error: masterError } = await this.supabaseClient
                .from(this.CONFIG.SUPABASE_TABLE)
                .select('id')
                .limit(1);
            
            if (masterError && masterError.code === '42P01') {
                console.log('📋 master_drugs table does not exist');
                this.logMasterDrugsSchema();
            }
        } catch (err) {
            console.warn('⚠️ Could not check master_drugs table:', err);
        }
    }

    logMasterDrugsSchema() {
        console.log(`
⚠️ Please create the master_drugs and warehouse_inventory tables in Supabase:

-- Master Drugs Table (Reference data from GitHub)
CREATE TABLE master_drugs (
    id TEXT PRIMARY KEY,
    trade_name TEXT NOT NULL,
    scientific_name TEXT,
    price DECIMAL(10,2),
    company TEXT,
    source TEXT,
    is_official_price BOOLEAN DEFAULT FALSE,
    data_sources TEXT[],
    last_updated TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Warehouse Inventory Table (User's stock)
CREATE TABLE warehouse_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,  -- RLS: Each user sees only their own data
    warehouse_id UUID REFERENCES warehouses(id),
    trade_name TEXT NOT NULL,
    scientific_name TEXT,
    price DECIMAL(10,2),
    quantity INTEGER DEFAULT 0,
    company TEXT,
    is_official_price BOOLEAN DEFAULT FALSE,
    source TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE warehouse_inventory ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own products
CREATE POLICY user_isolation ON warehouse_inventory
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Indexes
CREATE INDEX idx_master_drugs_trade_name ON master_drugs(trade_name);
CREATE INDEX idx_master_drugs_scientific_name ON master_drugs(scientific_name);
CREATE INDEX idx_warehouse_inventory_user_id ON warehouse_inventory(user_id);
CREATE INDEX idx_warehouse_inventory_warehouse_id ON warehouse_inventory(warehouse_id);
        `);
    }

    async syncToMasterDrugs(medicines) {
        // Sync reference data to master_drugs table (Seifeldeen + Shahin + EDA)
        if (!this.supabaseClient) {
            console.warn('⚠️ No Supabase client - saving to pending queue');
            await this.queueForSync(medicines);
            return { synced: 0, pending: medicines.length };
        }
        
        console.log(`☁️ Syncing ${medicines.length} medicines to master_drugs...`);
        
        const batchSize = 500;
        let synced = 0;
        let errors = 0;
        
        for (let i = 0; i < medicines.length; i += batchSize) {
            const batch = medicines.slice(i, i + batchSize);
            
            // Transform to master_drugs format
            const records = batch.map(med => ({
                id: med.id,
                trade_name: med.tradeName,
                scientific_name: med.scientificName,
                price: med.price,
                company: med.company,
                source: med.source,
                is_official_price: med.isOfficialPrice || false,
                data_sources: med.dataSources || [med.source],
                last_updated: med.lastUpdated
            }));
            
            try {
                const { error } = await this.supabaseClient
                    .from(this.CONFIG.SUPABASE_TABLE)
                    .upsert(records, { onConflict: 'id' });
                
                if (error) {
                    console.error('❌ master_drugs sync error:', error);
                    errors += batch.length;
                    await this.queueForSync(batch);
                } else {
                    synced += batch.length;
                    console.log(`✅ Synced batch ${i / batchSize + 1}: ${batch.length} records to master_drugs`);
                }
            } catch (err) {
                console.error('❌ master_drugs error:', err);
                errors += batch.length;
                await this.queueForSync(batch);
            }
        }
        
        console.log(`☁️ master_drugs sync complete: ${synced} synced, ${errors} pending`);
        return { synced, pending: errors };
    }

    // ============================================
    // Query from master_drugs for Voice Input
    // ============================================
    
    async queryFromMasterDrugs(query, options = {}) {
        // Query master_drugs table for voice input auto-correction
        if (!this.supabaseClient) {
            console.warn('⚠️ No Supabase client - querying from local IndexedDB');
            return this.searchLocalMedicines(query, options);
        }
        
        const { limit = 10, exactMatch = false } = options;
        
        try {
            console.log(`🔍 Querying master_drugs for: "${query}"`);
            
            let dbQuery = this.supabaseClient
                .from(this.CONFIG.SUPABASE_TABLE)
                .select('*');
            
            if (exactMatch) {
                // Exact match on trade_name
                dbQuery = dbQuery.eq('trade_name', query);
            } else {
                // Fuzzy search using ilike
                dbQuery = dbQuery.ilike('trade_name', `%${query}%`);
            }
            
            const { data, error } = await dbQuery
                .order('is_official_price', { ascending: false })  // Official prices first
                .limit(limit);
            
            if (error) {
                console.error('❌ master_drugs query error:', error);
                // Fallback to local
                return this.searchLocalMedicines(query, options);
            }
            
            console.log(`✅ Found ${data?.length || 0} matches in master_drugs`);
            return data || [];
            
        } catch (err) {
            console.error('❌ Query error:', err);
            return this.searchLocalMedicines(query, options);
        }
    }

    async searchLocalMedicines(query, options = {}) {
        // Fallback: Search from IndexedDB
        const medicines = await this.getAllMedicines();
        
        const normalizedQuery = query.toLowerCase();
        const matches = medicines.filter(med => 
            med.tradeName?.toLowerCase().includes(normalizedQuery) ||
            med.scientificName?.toLowerCase().includes(normalizedQuery)
        ).slice(0, options.limit || 10);
        
        return matches;
    }

    async queueForSync(medicines) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.PENDING_SYNC], 'readwrite');
            const store = transaction.objectStore(this.CONFIG.STORES.PENDING_SYNC);
            
            medicines.forEach(med => {
                store.put({
                    medicine: med,
                    queuedAt: Date.now(),
                    attempts: 0
                });
            });
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // ============================================
    // Main Sync Function
    // ============================================
    
    async performSync(options = {}) {
        if (this.isSyncing) {
            console.log('⏳ Sync already in progress');
            return { status: 'in_progress' };
        }
        
        this.isSyncing = true;
        this.notifyCallbacks('start', { timestamp: new Date() });
        
        try {
            // 1. Check for updates
            const updates = await this.checkForUpdates();
            
            if (!updates.hasUpdates && !options.force) {
                console.log('✓ Data is up to date');
                this.notifyCallbacks('up_to_date', {});
                return { status: 'up_to_date', medicines: await this.getAllMedicines() };
            }
            
            // 2. Merge data
            const mergedMedicines = this.mergeMedicines(updates.sources);
            
            // 3. Save hashes
            for (const [key, data] of Object.entries(updates.sources)) {
                await this.saveHash(key, data.hash, {
                    etag: data.etag,
                    timestamp: Date.now(),
                    recordCount: mergedMedicines.length
                });
            }
            
            // 4. Save to IndexedDB
            await this.saveMedicinesToIndexedDB(mergedMedicines);
            
            // 5. Sync to Supabase
            const syncResult = await this.syncToSupabase(mergedMedicines);
            
            // 6. Update sync metadata
            await this.updateSyncMeta({
                lastSync: Date.now(),
                recordCount: mergedMedicines.length,
                sourcesUpdated: Object.keys(updates.sources),
                supabaseSynced: syncResult.synced,
                supabasePending: syncResult.pending
            });
            
            this.notifyCallbacks('complete', {
                medicines: mergedMedicines,
                syncResult,
                timestamp: new Date()
            });
            
            return {
                status: 'completed',
                medicines: mergedMedicines,
                syncResult
            };
            
        } catch (error) {
            console.error('❌ Sync failed:', error);
            this.notifyCallbacks('error', { error });
            return { status: 'error', error: error.message };
        } finally {
            this.isSyncing = false;
        }
    }

    async saveMedicinesToIndexedDB(medicines) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.MEDICINES], 'readwrite');
            const store = transaction.objectStore(this.CONFIG.STORES.MEDICINES);
            
            store.clear();
            
            medicines.forEach(med => store.put(med));
            
            transaction.oncomplete = () => {
                console.log(`✅ Saved ${medicines.length} medicines to IndexedDB`);
                resolve();
            };
            
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async updateSyncMeta(meta) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.SYNC_META], 'readwrite');
            const store = transaction.objectStore(this.CONFIG.STORES.SYNC_META);
            
            store.put({
                id: 'lastSync',
                ...meta
            });
            
            transaction.oncomplete = () => resolve();
        });
    }

    // ============================================
    // Data Access Methods
    // ============================================
    
    async getAllMedicines() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.MEDICINES], 'readonly');
            const store = transaction.objectStore(this.CONFIG.STORES.MEDICINES);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async searchMedicines(query, options = {}) {
        const medicines = await this.getAllMedicines();
        
        const results = medicines.map(med => {
            const tradeSim = this.calculateSimilarity(query, med.tradeName);
            const sciSim = this.calculateSimilarity(query, med.scientificName);
            const score = Math.max(tradeSim, sciSim * 0.8);
            
            return { ...med, score };
        }).filter(med => med.score >= (options.threshold || 0.6))
          .sort((a, b) => b.score - a.score)
          .slice(0, options.limit || 10);
        
        return results;
    }

    calculateSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        
        const s1 = str1.toLowerCase().trim();
        const s2 = str2.toLowerCase().trim();
        
        if (s1 === s2) return 1.0;
        if (s1.includes(s2) || s2.includes(s1)) return 0.9;
        
        // Levenshtein distance
        const len1 = s1.length;
        const len2 = s2.length;
        const matrix = [];
        
        for (let i = 0; i <= len1; i++) matrix[i] = [i];
        for (let j = 0; j <= len2; j++) matrix[0][j] = j;
        
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
            }
        }
        
        const maxLen = Math.max(len1, len2);
        return maxLen === 0 ? 1 : (maxLen - matrix[len1][len2]) / maxLen;
    }

    // ============================================
    // Event Callbacks
    // ============================================
    
    onSync(callback) {
        this.syncCallbacks.push(callback);
    }

    notifyCallbacks(event, data) {
        this.syncCallbacks.forEach(cb => {
            try {
                cb(event, data);
            } catch (err) {
                console.error('❌ Sync callback error:', err);
            }
        });
    }

    // ============================================
    // Auto Sync Setup
    // ============================================
    
    startAutoSync(interval = this.CONFIG.SYNC_INTERVAL) {
        console.log(`🔄 Auto sync started (interval: ${interval}ms)`);
        
        // Check on startup
        setTimeout(() => this.performSync(), 5000);
        
        // Periodic checks
        return setInterval(() => {
            this.performSync();
        }, interval);
    }

    // ============================================
    // Sync Status
    // ============================================
    
    async getSyncStatus() {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.CONFIG.STORES.SYNC_META], 'readonly');
            const store = transaction.objectStore(this.CONFIG.STORES.SYNC_META);
            const request = store.get('lastSync');
            
            request.onsuccess = () => {
                const medicines = this.getAllMedicines().then(meds => meds.length);
                
                Promise.all([medicines]).then(([count]) => {
                    resolve({
                        lastSync: request.result?.lastSync || null,
                        recordCount: count,
                        supabaseSynced: request.result?.supabaseSynced || 0,
                        isOnline: navigator.onLine
                    });
                });
            };
            
            request.onerror = () => resolve({ error: true });
        });
    }
}

// ============================================
// Export for use
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DrugDataSynchronizer;
} else {
    window.DrugDataSynchronizer = DrugDataSynchronizer;
}

console.log('✅ Drug Data Synchronizer loaded');
