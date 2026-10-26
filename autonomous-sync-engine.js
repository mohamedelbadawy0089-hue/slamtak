// ============================================
// Autonomous Sync Engine - v2026.0
// Auto-Pilot Sync | Background Cataloging | Dynamic Price Refresh
// Fully Autonomous Drug Encyclopedia Management
// ============================================

class AutonomousSyncEngine {
    constructor(config = {}) {
        this.config = {
            syncInterval: config.syncInterval || 5 * 60 * 1000, // 5 minutes default
            serverEndpoint: config.serverEndpoint || '/api/drug-encyclopedia',
            priceEndpoint: config.priceEndpoint || '/api/prices/current',
            maxRetries: config.maxRetries || 3,
            retryDelay: config.retryDelay || 5000,
            ...config
        };
        
        this.state = {
            isOnline: navigator.onLine,
            lastSync: null,
            syncInProgress: false,
            pendingUpdates: [],
            catalogVersion: localStorage.getItem('ae_catalog_version') || '0.0.0',
            encyclopedia: null,
            priceCache: new Map()
        };
        
        this.callbacks = {
            onEncyclopediaUpdate: [],
            onPriceUpdate: [],
            onNewDrugsIndexed: [],
            onSyncComplete: [],
            onSyncError: []
        };
        
        this.syncTimer = null;
        this.priceMonitor = null;
        this.backgroundWorker = null;
        
        this.init();
    }
    
    // Initialize the autonomous engine
    async init() {
        console.log('🤖 Autonomous Sync Engine initializing...');
        
        // Load cached encyclopedia
        await this.loadLocalEncyclopedia();
        
        // Setup network monitoring
        this.setupNetworkMonitoring();
        
        // Start auto-pilot sync
        this.startAutoPilotSync();
        
        // Start price monitoring
        this.startPriceMonitoring();
        
        // Initialize background cataloging
        this.initBackgroundCataloging();
        
        console.log('✅ Autonomous Sync Engine fully initialized');
        console.log(`📚 Encyclopedia version: ${this.state.catalogVersion}`);
        console.log(`🔄 Auto-sync interval: ${this.config.syncInterval / 1000}s`);
    }
    
    // ============================================
    // AUTO-PILOT SYNC: Silent Background Updates
    // ============================================
    
    startAutoPilotSync() {
        // Immediate check
        if (this.state.isOnline) {
            this.performSilentSync();
        }
        
        // Set up interval
        this.syncTimer = setInterval(() => {
            if (this.state.isOnline && !this.state.syncInProgress) {
                this.performSilentSync();
            }
        }, this.config.syncInterval);
        
        console.log('🔄 Auto-Pilot Sync: ACTIVE');
    }
    
    async performSilentSync() {
        if (this.state.syncInProgress) return;
        
        this.state.syncInProgress = true;
        console.log('🔄 Starting silent encyclopedia sync...');
        
        try {
            // Fetch latest encyclopedia from server
            const response = await this.fetchWithRetry(
                `${this.config.serverEndpoint}?version=${this.state.catalogVersion}`,
                { method: 'GET' }
            );
            
            if (response.success && response.data) {
                const serverData = response.data;
                
                // Check if update needed
                if (serverData.version !== this.state.catalogVersion) {
                    console.log(`📦 New encyclopedia version available: ${serverData.version}`);
                    
                    // Merge with local
                    const merged = await this.mergeEncyclopedia(serverData);
                    
                    // Save locally
                    await this.saveEncyclopediaLocally(merged, serverData.version);
                    
                    // Trigger background cataloging for new drugs
                    if (serverData.newDrugs && serverData.newDrugs.length > 0) {
                        this.indexNewDrugsInBackground(serverData.newDrugs);
                    }
                    
                    // Update state
                    this.state.lastSync = new Date().toISOString();
                    this.state.catalogVersion = serverData.version;
                    
                    // Notify listeners
                    this.emit('onEncyclopediaUpdate', merged);
                    this.emit('onSyncComplete', { 
                        type: 'encyclopedia', 
                        version: serverData.version,
                        newDrugs: serverData.newDrugs?.length || 0
                    });
                    
                    console.log('✅ Encyclopedia sync complete');
                } else {
                    console.log('ℹ️ Encyclopedia up to date');
                }
            }
        } catch (error) {
            console.error('❌ Silent sync failed:', error);
            this.emit('onSyncError', error);
            
            // Queue for retry
            this.queueForRetry('encyclopedia', error);
        } finally {
            this.state.syncInProgress = false;
        }
    }
    
    // ============================================
    // BACKGROUND CATALOGING: Index New Drugs
    // ============================================
    
    initBackgroundCataloging() {
        // Create background worker for indexing
        this.backgroundWorker = {
            queue: [],
            processing: false,
            
            add: (drugs) => {
                this.backgroundWorker.queue.push(...drugs);
                if (!this.backgroundWorker.processing) {
                    this.backgroundWorker.process();
                }
            },
            
            process: async () => {
                this.backgroundWorker.processing = true;
                
                while (this.backgroundWorker.queue.length > 0) {
                    const drug = this.backgroundWorker.queue.shift();
                    await this.indexDrug(drug);
                    
                    // Small delay to not block main thread
                    await new Promise(r => setTimeout(r, 10));
                }
                
                this.backgroundWorker.processing = false;
            }
        };
        
        console.log('📚 Background Cataloging: ACTIVE');
    }
    
    indexNewDrugsInBackground(newDrugs) {
        console.log(`🔄 Background cataloging: ${newDrugs.length} new drugs to index`);
        
        this.backgroundWorker.add(newDrugs);
        
        // Store indexed drugs
        const indexedDrugs = JSON.parse(localStorage.getItem('ae_indexed_drugs') || '[]');
        
        for (const drug of newDrugs) {
            // Generate phonetic variants
            const phoneticVariants = this.generatePhoneticVariants(drug);
            
            // Create search index
            const searchIndex = this.createSearchIndex(drug);
            
            // Store
            const indexedDrug = {
                ...drug,
                phoneticVariants,
                searchIndex,
                indexedAt: new Date().toISOString()
            };
            
            indexedDrugs.push(indexedDrug);
            
            console.log(`✅ Indexed: ${drug.tradeNames[0]} (${phoneticVariants.length} phonetic variants)`);
        }
        
        localStorage.setItem('ae_indexed_drugs', JSON.stringify(indexedDrugs));
        
        // Update voice matching dictionary
        this.updateVoiceDictionary(indexedDrugs);
        
        this.emit('onNewDrugsIndexed', newDrugs);
    }
    
    async indexDrug(drug) {
        // Generate comprehensive phonetic mappings
        const variants = [];
        
        for (const tradeName of drug.tradeNames) {
            // Arabic variations
            variants.push(...this.generateArabicVariations(tradeName));
            
            // Common mispronunciations
            variants.push(...this.generateMispronunciations(tradeName));
            
            // Phonetic codes
            variants.push(this.generatePhoneticCode(tradeName));
        }
        
        // Save to local phonetic index
        const phoneticIndex = JSON.parse(localStorage.getItem('ae_phonetic_index') || '{}');
        
        for (const variant of variants) {
            if (!phoneticIndex[variant]) {
                phoneticIndex[variant] = [];
            }
            phoneticIndex[variant].push(drug.id);
        }
        
        localStorage.setItem('ae_phonetic_index', JSON.stringify(phoneticIndex));
        
        return variants;
    }
    
    generatePhoneticVariants(drug) {
        const variants = [];
        
        drug.tradeNames.forEach(name => {
            // Lowercase
            variants.push(name.toLowerCase());
            
            // No spaces
            variants.push(name.toLowerCase().replace(/\s+/g, ''));
            
            // Arabic transliteration variations
            const arabicTransliterations = this.transliterateToArabic(name);
            variants.push(...arabicTransliterations);
        });
        
        return [...new Set(variants)];
    }
    
    generateArabicVariations(name) {
        // Generate Arabic script variations
        const variations = [];
        const arabicName = this.transliterateToArabic(name);
        variations.push(...arabicName);
        return variations;
    }
    
    generateMispronunciations(name) {
        // Generate likely mispronunciations
        const mispronunciations = [];
        const lower = name.toLowerCase();
        
        // Common patterns
        const patterns = [
            { from: /ph/g, to: 'f' },
            { from: /th/g, to: 't' },
            { from: /sh/g, to: 's' },
            { from: /ch/g, to: 'c' },
            { from: /gh/g, to: 'g' },
            { from: /kh/g, to: 'k' },
            { from: /([aeiou])/g, to: '' }, // Remove vowels
        ];
        
        patterns.forEach(p => {
            mispronunciations.push(lower.replace(p.from, p.to));
        });
        
        return [...new Set(mispronunciations)];
    }
    
    generatePhoneticCode(name) {
        // Generate Soundex-like code
        return name.toLowerCase()
            .replace(/[aeiou]/g, '')
            .replace(/ph/g, 'f')
            .replace(/th/g, 't')
            .replace(/sh/g, 's')
            .replace(/ch/g, 'c')
            .replace(/(.)(?=.*\1)/g, '') // Remove duplicates
            .substring(0, 4);
    }
    
    transliterateToArabic(name) {
        // Simplified transliteration
        const transliterations = [];
        
        // Basic Arabic mapping
        const arabicMap = {
            'a': 'ا', 'b': 'ب', 'c': 'ك', 'd': 'د', 'e': '',
            'f': 'ف', 'g': 'ج', 'h': 'ه', 'i': 'ي', 'j': 'ج',
            'k': 'ك', 'l': 'ل', 'm': 'م', 'n': 'ن', 'o': 'و',
            'p': 'ب', 'q': 'ك', 'r': 'ر', 's': 'س', 't': 'ت',
            'u': '', 'v': 'ف', 'w': 'و', 'x': 'كس', 'y': 'ي',
            'z': 'ز'
        };
        
        let arabic = '';
        for (const char of name.toLowerCase()) {
            arabic += arabicMap[char] || char;
        }
        
        transliterations.push(arabic);
        return transliterations;
    }
    
    createSearchIndex(drug) {
        // Create searchable terms
        const terms = [];
        
        // Trade names
        drug.tradeNames.forEach(name => {
            terms.push(name.toLowerCase());
            terms.push(...name.toLowerCase().split(/\s+/));
        });
        
        // Scientific name
        terms.push(drug.scientificName.toLowerCase());
        terms.push(...drug.scientificName.toLowerCase().split(/\s+/));
        
        // Company
        terms.push(drug.company.toLowerCase());
        
        // Category
        terms.push(drug.category.toLowerCase());
        
        return [...new Set(terms)];
    }
    
    updateVoiceDictionary(indexedDrugs) {
        // Update the voice matching dictionary
        const dictionary = {};
        
        indexedDrugs.forEach(drug => {
            const mainName = drug.tradeNames[0].toLowerCase();
            
            dictionary[mainName] = {
                id: drug.id,
                names: drug.tradeNames,
                phoneticVariants: drug.phoneticVariants,
                price: drug.price,
                company: drug.company,
                category: drug.category
            };
        });
        
        localStorage.setItem('ae_voice_dictionary', JSON.stringify(dictionary));
        
        // Update global fuse search if available
        if (window.fuseSearch && window.fuseSearch.updateDictionary) {
            window.fuseSearch.updateDictionary(dictionary);
        }
        
        console.log('🎤 Voice dictionary updated:', Object.keys(dictionary).length, 'drugs');
    }
    
    // ============================================
    // DYNAMIC PRICE REFRESH: Real-time Price Updates
    // ============================================
    
    startPriceMonitoring() {
        // Check prices every 2 minutes
        this.priceMonitor = setInterval(() => {
            if (this.state.isOnline) {
                this.checkPriceUpdates();
            }
        }, 2 * 60 * 1000);
        
        console.log('💰 Price Monitor: ACTIVE (2min interval)');
    }
    
    async checkPriceUpdates() {
        try {
            const response = await this.fetchWithRetry(
                `${this.config.priceEndpoint}?lastCheck=${this.state.lastSync || ''}`,
                { method: 'GET' }
            );
            
            if (response.success && response.data && response.data.length > 0) {
                console.log(`💰 ${response.data.length} price updates detected`);
                
                // Apply updates
                const updatedDrugs = this.applyPriceUpdates(response.data);
                
                // Save
                await this.saveEncyclopediaLocally(this.state.encyclopedia, this.state.catalogVersion);
                
                // Notify UI
                this.emit('onPriceUpdate', updatedDrugs);
                
                // Show notification
                updatedDrugs.forEach(drug => {
                    console.log(`💰 Price updated: ${drug.name} → ${drug.newPrice} ج.م`);
                });
            }
        } catch (error) {
            console.error('❌ Price check failed:', error);
        }
    }
    
    applyPriceUpdates(updates) {
        const updatedDrugs = [];
        
        updates.forEach(update => {
            const drug = this.findDrugById(update.drugId);
            if (drug) {
                const oldPrice = drug.price;
                drug.price = update.newPrice;
                drug.priceUpdatedAt = update.timestamp;
                drug.priceChange = update.change; // 'increase', 'decrease', or 'same'
                
                updatedDrugs.push({
                    ...drug,
                    oldPrice,
                    newPrice: update.newPrice
                });
            }
        });
        
        // Update voice dictionary with new prices
        this.updateVoiceDictionary(
            JSON.parse(localStorage.getItem('ae_indexed_drugs') || '[]')
        );
        
        return updatedDrugs;
    }
    
    findDrugById(id) {
        if (!this.state.encyclopedia) return null;
        
        for (const key in this.state.encyclopedia) {
            if (this.state.encyclopedia[key].id === id) {
                return this.state.encyclopedia[key];
            }
        }
        return null;
    }
    
    // ============================================
    // OFFLINE-FIRST: Local Persistence
    // ============================================
    
    async loadLocalEncyclopedia() {
        const cached = localStorage.getItem('ae_encyclopedia');
        if (cached) {
            this.state.encyclopedia = JSON.parse(cached);
            console.log('📚 Loaded encyclopedia from cache');
        } else {
            // Load default/fallback encyclopedia
            this.state.encyclopedia = this.getDefaultEncyclopedia();
            console.log('📚 Loaded default encyclopedia');
        }
    }
    
    async saveEncyclopediaLocally(data, version) {
        localStorage.setItem('ae_encyclopedia', JSON.stringify(data));
        localStorage.setItem('ae_catalog_version', version);
        localStorage.setItem('ae_last_sync', new Date().toISOString());
        
        this.state.encyclopedia = data;
        this.state.lastSync = new Date().toISOString();
        
        console.log(`💾 Encyclopedia saved locally (v${version})`);
    }
    
    getDefaultEncyclopedia() {
        // Fallback encyclopedia for offline-first operation
        return {
            'panadol': {
                id: 'pan-001',
                tradeNames: ['Panadol', 'Panadol Extra'],
                scientificName: 'Paracetamol',
                price: 45.50,
                company: 'GSK',
                category: 'Analgesic',
                lastUpdated: '2026-01-01'
            },
            'augmentin': {
                id: 'aug-001',
                tradeNames: ['Augmentin'],
                scientificName: 'Amoxicillin/Clavulanate',
                price: 78.00,
                company: 'GSK',
                category: 'Antibiotic',
                lastUpdated: '2026-01-01'
            }
            // ... more default drugs
        };
    }
    
    // ============================================
    // NETWORK & UTILITY FUNCTIONS
    // ============================================
    
    setupNetworkMonitoring() {
        window.addEventListener('online', () => {
            console.log('🌐 Network: ONLINE - Resuming sync');
            this.state.isOnline = true;
            
            // Trigger immediate sync
            this.performSilentSync();
            
            // Process any pending updates
            this.processPendingUpdates();
        });
        
        window.addEventListener('offline', () => {
            console.log('📴 Network: OFFLINE - Switching to autonomous mode');
            this.state.isOnline = false;
        });
    }
    
    async fetchWithRetry(url, options, retries = 0) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client-Version': this.state.catalogVersion,
                    ...options.headers
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            return { success: true, data };
            
        } catch (error) {
            if (retries < this.config.maxRetries) {
                console.log(`🔄 Retry ${retries + 1}/${this.config.maxRetries}...`);
                await new Promise(r => setTimeout(r, this.config.retryDelay));
                return this.fetchWithRetry(url, options, retries + 1);
            }
            throw error;
        }
    }
    
    queueForRetry(type, error) {
        this.state.pendingUpdates.push({
            type,
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
        localStorage.setItem('ae_pending_updates', JSON.stringify(this.state.pendingUpdates));
    }
    
    async processPendingUpdates() {
        if (this.state.pendingUpdates.length === 0) return;
        
        console.log(`🔄 Processing ${this.state.pendingUpdates.length} pending updates...`);
        
        // Retry all pending
        for (const update of this.state.pendingUpdates) {
            if (update.type === 'encyclopedia') {
                await this.performSilentSync();
            }
        }
        
        // Clear processed
        this.state.pendingUpdates = [];
        localStorage.removeItem('ae_pending_updates');
    }
    
    // Event system
    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
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
    
    // Public API
    getEncyclopedia() {
        return this.state.encyclopedia;
    }
    
    getDrugPrice(drugId) {
        const drug = this.findDrugById(drugId);
        return drug ? drug.price : null;
    }
    
    forceSync() {
        return this.performSilentSync();
    }
    
    destroy() {
        if (this.syncTimer) clearInterval(this.syncTimer);
        if (this.priceMonitor) clearInterval(this.priceMonitor);
        console.log('🛑 Autonomous Sync Engine stopped');
    }
}

// ============================================
// Export for use
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AutonomousSyncEngine };
}

window.AutonomousSyncEngine = AutonomousSyncEngine;

// Auto-initialize if config present
if (window.AE_CONFIG) {
    window.autonomousEngine = new AutonomousSyncEngine(window.AE_CONFIG);
}

console.log('🤖 Autonomous Sync Engine loaded - Ready for fully autonomous operation');
