// ============================================
// Global Drug Database Loader
// Loads comprehensive JSON databases with thousands of drugs
// ============================================

class GlobalDrugDatabase {
    constructor(config = {}) {
        this.config = {
            jsonSources: config.jsonSources || [
                { name: 'egyptian_master_authority', url: './data/egyptian-master-database-massive.json' },
                { name: 'egyptian_drug_authority', url: './data/eda-drugs.json' },
                { name: 'seifeldeen_pharmacy', url: './data/seifeldeen.json' }
            ],
            batchSize: config.batchSize || 1000,
            enableCompression: config.enableCompression !== false,
            ...config
        };
        
        this.databases = new Map();
        this.totalDrugs = 0;
        this.isLoading = false;
        this.loadProgress = {
            current: 0,
            total: 0,
            phase: 'idle'
        };
        
        this.onProgress = null;
        this.onComplete = null;
        this.onError = null;
        
        // Stats
        this.stats = {
            databasesLoaded: 0,
            totalDrugs: 0,
            loadTime: 0,
            avgDrugsPerSecond: 0
        };
    }
    
    // Initialize and load all databases
    async initialize() {
        console.log('🌍 Initializing Global Drug Database (High Capacity Mode)...');
        
        const startTime = performance.now();
        this.initWorker();
        
        try {
            // 1. Check if we need to sync with Cloud (once per day)
            await this.handleDailySync();

            // 2. Load from IndexedDB (fastest)
            let drugs = await this.loadFromIndexedDB();
            
            // 3. Fallback to Master File if DB is empty
            if (!drugs || drugs.length < 100) {
                console.log('📦 Loading initial massive master database...');
                const response = await fetch('./data/egyptian-master-database-massive.json');
                const data = await response.json();
                drugs = this.normalizeDrugData(data, 'master_file');
                await this.saveToIndexedDB(drugs);
            }
            
            this.totalDrugs = drugs.length;
            this.stats.totalDrugs = drugs.length;
            
            // 4. Initialize Worker with the full dataset
            this.worker.postMessage({ action: 'INITIALIZE', data: { drugs: drugs } });
            
            const loadTime = performance.now() - startTime;
            console.log(`✅ Global Database ready: ${drugs.length} drugs in ${loadTime.toFixed(0)}ms`);
            
            return drugs;
            
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            // Fallback to local MASTER_DRUG_DATA if available
            if (window.MASTER_DRUG_DATA) {
                const normalized = this.normalizeDrugData(window.MASTER_DRUG_DATA, 'fallback');
                this.worker.postMessage({ action: 'INITIALIZE', data: { drugs: normalized } });
                return normalized;
            }
            return [];
        }
    }

    initWorker() {
        if (this.worker) return;
        this.worker = new Worker('./drug-search-worker.js');
        this.workerListeners = new Map();
        
        this.worker.onmessage = (e) => {
            const { action, data, query } = e.data;
            if (action === 'SEARCH_RESULTS' && this.workerListeners.has(query)) {
                const resolve = this.workerListeners.get(query);
                this.workerListeners.delete(query);
                resolve(data);
            }
        };
    }

    async handleDailySync() {
        const lastSync = localStorage.getItem('slamtak_last_drug_sync');
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;

        if (!lastSync || (now - parseInt(lastSync)) > ONE_DAY) {
            console.log('🔄 Performing daily medical database check...');
            try {
                // In a real cloud scenario, this would be an external URL
                // For now, we sync with our master record locally
                const response = await fetch('./data/egyptian-master-database-massive.json?t=' + now);
                const data = await response.json();
                const drugs = this.normalizeDrugData(data, 'cloud_sync');
                await this.saveToIndexedDB(drugs);
                localStorage.setItem('slamtak_last_drug_sync', now.toString());
                console.log('✨ Database synced successfully.');
            } catch (err) {
                console.warn('Sync failed (offline or network):', err);
            }
        }
    }

    // Search drugs using the background worker for high speed
    async searchAsync(query, options = {}) {
        if (!this.worker) this.initWorker();
        
        return new Promise((resolve) => {
            this.workerListeners.set(query, resolve);
            this.worker.postMessage({ 
                action: 'SEARCH', 
                data: { query, options } 
            });
            
            // Safety timeout
            setTimeout(() => {
                if (this.workerListeners.has(query)) {
                    this.workerListeners.delete(query);
                    resolve([]);
                }
            }, 3000);
        });
    }
    
    // Normalize drug data from various formats
    normalizeDrugData(data, source) {
        const drugs = Array.isArray(data) ? data : data.drugs || [];
        
        return drugs.map((drug, index) => ({
            id: drug.id || drug.code || `${source}_${index}`,
            tradeName: drug.tradeName || drug.trade_name || drug.name || drug.brand || 'Unknown',
            scientificName: drug.scientificName || drug.scientific_name || drug.generic_name || drug.generic || '',
            company: drug.company || drug.manufacturer || drug.supplier || drug.pharmaceutical_company || 'Unknown',
            price: parseFloat(drug.price || drug.official_price || drug.retail_price || 0),
            category: drug.category || drug.therapeutic_class || drug.class || 'Uncategorized',
            dosageForm: drug.dosageForm || drug.dosage_form || drug.form || 'Tablet',
            strength: drug.strength || drug.concentration || '',
            voiceAliases: this.generateVoiceAliases(drug),
            phoneticCodes: this.generatePhoneticCodes(drug.tradeName || drug.name),
            source: source,
            lastUpdated: drug.lastUpdated || new Date().toISOString()
        }));
    }
    
    // Generate voice aliases for a drug
    generateVoiceAliases(drug) {
        const aliases = [];
        const name = (drug.tradeName || drug.name || '').toLowerCase();
        
        // Original name
        aliases.push(name);
        
        // Common variations
        const variations = [
            name.replace(/ph/g, 'f'),
            name.replace(/th/g, 't'),
            name.replace(/sh/g, 's'),
            name.replace(/ch/g, 'c'),
            name.replace(/ie/g, 'i'),
            name.replace(/ee/g, 'i'),
            name.replace(/oo/g, 'u'),
            // Remove vowels for phonetic matching
            name.replace(/[aeiou]/g, '')
        ];
        
        aliases.push(...variations);
        
        // Remove duplicates
        return [...new Set(aliases)];
    }
    
    // Generate phonetic codes optimized for Egyptian/Arabic accents and medical terms
    generatePhoneticCodes(name) {
        const codes = new Set();
        const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
        if (!normalized) return [];
        
        // 1. Voice-specific normalization (handling Egyptian accents P->B, V->F)
        let phonetic = normalized
            .replace(/p/g, 'b')
            .replace(/v/g, 'f')
            .replace(/ph/g, 'f')
            .replace(/gh/g, 'g')
            .replace(/th/g, 't')
            .replace(/sh/g, 's')
            .replace(/tion/g, 'sn')
            .replace(/ce/g, 'se')
            .replace(/ci/g, 'si')
            .replace(/cy/g, 'sy')
            .replace(/ca/g, 'ka')
            .replace(/co/g, 'ko')
            .replace(/cu/g, 'ku')
            .replace(/ck/g, 'k');

        // 2. Remove vowels (except first letter)
        const first = phonetic[0];
        const noVowels = first + phonetic.substring(1).replace(/[aeiouyhwy]/g, '');
        
        // 3. Various length codes
        codes.add(noVowels.substring(0, 3));
        codes.add(noVowels.substring(0, 4));
        codes.add(noVowels.substring(0, 5));
        
        // 4. Prefix based code
        codes.add(normalized.substring(0, 3));
        
        return Array.from(codes);
    }
    
    // Remove duplicate drugs
    removeDuplicates(drugs) {
        const seen = new Set();
        const unique = [];
        
        drugs.forEach(drug => {
            const key = `${drug.tradeName.toLowerCase()}_${drug.scientificName.toLowerCase()}`;
            
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(drug);
            }
        });
        
        return unique;
    }
    
    // Load from IndexedDB cache
    async loadFromIndexedDB() {
        try {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('GlobalDrugDB', 1);
                
                request.onerror = () => reject(request.error);
                
                request.onsuccess = (event) => {
                    const db = event.target.result;
                    
                    if (!db.objectStoreNames.contains('drugs')) {
                        resolve([]);
                        return;
                    }
                    
                    const transaction = db.transaction(['drugs'], 'readonly');
                    const store = transaction.objectStore('drugs');
                    const getRequest = store.getAll();
                    
                    getRequest.onsuccess = () => resolve(getRequest.result);
                    getRequest.onerror = () => reject(getRequest.error);
                };
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('drugs')) {
                        db.createObjectStore('drugs', { keyPath: 'id' });
                    }
                };
            });
        } catch (error) {
            console.warn('Could not load from IndexedDB:', error);
            return [];
        }
    }
    
    // Save to IndexedDB cache
    async saveToIndexedDB(drugs) {
        try {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('GlobalDrugDB', 1);
                
                request.onsuccess = (event) => {
                    const db = event.target.result;
                    const transaction = db.transaction(['drugs'], 'readwrite');
                    const store = transaction.objectStore('drugs');
                    
                    // Clear existing
                    store.clear();
                    
                    // Add all drugs in batches
                    let completed = 0;
                    const batchSize = 100;
                    
                    function addBatch(start) {
                        const batch = drugs.slice(start, start + batchSize);
                        
                        batch.forEach(drug => {
                            store.put(drug);
                        });
                        
                        completed += batch.length;
                        
                        if (completed < drugs.length) {
                            setTimeout(() => addBatch(start + batchSize), 0);
                        } else {
                            resolve(true);
                        }
                    }
                    
                    addBatch(0);
                };
                
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('Could not save to IndexedDB:', error);
        }
    }
    
    // Search drugs with phonetic and fuzzy matching
    search(query, options = {}) {
        const { limit = 10, threshold = 0.4 } = options;
        
        const allDrugs = this.getAllDrugs();
        const normalizedQuery = query.toLowerCase().trim();
        const queryPhonetics = this.generatePhoneticCodes(normalizedQuery);
        
        console.log(`🔍 Searching for "${normalizedQuery}" (Phonetics: ${queryPhonetics.join(', ')})`);
        
        const results = allDrugs.map(drug => {
            let score = 0;
            const tradeName = drug.tradeName.toLowerCase();
            
            // 1. Exact match (Score: 1.0)
            if (tradeName === normalizedQuery) {
                score = 1.0;
            }
            // 2. Starts with (Score: 0.9)
            else if (tradeName.startsWith(normalizedQuery)) {
                score = 0.9;
            }
            // 3. Phonetic match (Score: 0.85)
            else if (drug.phoneticCodes?.some(code => queryPhonetics.includes(code))) {
                score = 0.85;
            }
            // 4. Voice alias match (Score: 0.8)
            else if (drug.voiceAliases?.some(alias => alias.toLowerCase() === normalizedQuery)) {
                score = 0.8;
            }
            // 5. Fuzzy match (Levenshtein)
            else {
                const similarity = this.calculateSimilarity(normalizedQuery, tradeName);
                if (similarity > 0.6) {
                    score = similarity * 0.75; // Cap fuzzy score
                } else {
                    // Check scientific name as last resort
                    const sciSimilarity = this.calculateSimilarity(normalizedQuery, drug.scientificName.toLowerCase());
                    score = sciSimilarity * 0.5;
                }
            }
            
            return { drug, score };
        }).filter(r => r.score >= threshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        
        return results;
    }

    // Advanced String Similarity (Levenshtein Distance)
    calculateSimilarity(a, b) {
        if (a === b) return 1.0;
        if (a.length === 0 || b.length === 0) return 0;

        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

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

        const distance = matrix[b.length][a.length];
        const maxLength = Math.max(a.length, b.length);
        return 1.0 - (distance / maxLength);
    }
    
    // Get all drugs
    getAllDrugs() {
        let allDrugs = [];
        
        for (const drugs of this.databases.values()) {
            allDrugs.push(...drugs);
        }
        
        return this.removeDuplicates(allDrugs);
    }
    
    // Get drugs by category
    getByCategory(category) {
        return this.getAllDrugs().filter(drug => 
            drug.category.toLowerCase() === category.toLowerCase()
        );
    }
    
    // Get drug by ID
    getById(id) {
        for (const drugs of this.databases.values()) {
            const drug = drugs.find(d => d.id === id);
            if (drug) return drug;
        }
        return null;
    }
    
    // Get fallback dataset (minimal)
    getFallbackDataset() {
        return [
            { id: '1', tradeName: 'Panadol', scientificName: 'Paracetamol', company: 'GSK', price: 45.50, category: 'Analgesic', voiceAliases: ['panadol', 'benidorm', 'bernardo'] },
            { id: '2', tradeName: 'Augmentin', scientificName: 'Amoxicillin/Clavulanate', company: 'GSK', price: 78.00, category: 'Antibiotic', voiceAliases: ['augmentin', 'ogmentin'] },
            { id: '3', tradeName: 'Brufen', scientificName: 'Ibuprofen', company: 'Abbott', price: 32.00, category: 'NSAID', voiceAliases: ['brufen', 'brofen'] },
            { id: '4', tradeName: 'Cataflam', scientificName: 'Diclofenac', company: 'Novartis', price: 55.00, category: 'NSAID', voiceAliases: ['cataflam', 'kataflam'] },
            { id: '5', tradeName: 'Amoxicillin', scientificName: 'Amoxicillin Trihydrate', company: 'Various', price: 25.50, category: 'Antibiotic', voiceAliases: ['amoxicillin', 'amoxil'] },
            { id: '6', tradeName: 'Comtrex', scientificName: 'Paracetamol/Pseudoephedrine', company: 'Bristol', price: 38.00, category: 'Cold & Flu', voiceAliases: ['comtrex', 'kontrex'] },
            { id: '7', tradeName: 'Cetal', scientificName: 'Paracetamol', company: 'EIPICO', price: 22.00, category: 'Analgesic', voiceAliases: ['cetal', 'ketal'] },
            { id: '8', tradeName: 'Adol', scientificName: 'Paracetamol', company: 'Arab Drug', price: 20.00, category: 'Analgesic', voiceAliases: ['adol', 'adool'] }
        ];
    }
    
    // Get stats
    getStats() {
        return {
            ...this.stats,
            totalDrugs: this.totalDrugs,
            databasesLoaded: this.databases.size,
            sources: Array.from(this.databases.keys())
        };
    }
    
    // Clear cache
    async clearCache() {
        try {
            const request = indexedDB.open('GlobalDrugDB', 1);
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['drugs'], 'readwrite');
                const store = transaction.objectStore('drugs');
                store.clear();
            };
            
            console.log('🧹 Drug database cache cleared');
        } catch (error) {
            console.error('Failed to clear cache:', error);
        }
    }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GlobalDrugDatabase };
}

window.GlobalDrugDatabase = GlobalDrugDatabase;

console.log('🌍 Global Drug Database loaded');
console.log('📚 Ready for thousands of drugs');
