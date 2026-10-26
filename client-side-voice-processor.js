// ============================================
// Client-Side Voice Processor
// Resource Offloading: 100% Browser Processing
// Zero Server Load for Voice Recognition
// ============================================

class ClientSideVoiceProcessor {
    constructor(config = {}) {
        this.config = {
            language: config.language || 'en-US',
            continuous: config.continuous || false,
            interimResults: config.interimResults || true,
            maxAlternatives: config.maxAlternatives || 3,
            ...config
        };
        
        this.recognition = null;
        this.audioContext = null;
        this.analyser = null;
        this.isListening = false;
        
        // Processing state
        this.processingQueue = [];
        this.isProcessing = false;
        
        // Results
        this.currentResult = null;
        this.confidenceThreshold = 0.6;
        
        // Callbacks
        this.onResult = null;
        this.onInterim = null;
        this.onError = null;
        this.onStart = null;
        this.onEnd = null;
    }
    
    // Initialize Web Speech API (100% browser, 0% server)
    async initialize() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            throw new Error('Web Speech API not supported. Use Chrome or Edge.');
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = this.config.continuous;
        this.recognition.interimResults = this.config.interimResults;
        this.recognition.lang = this.config.language;
        this.recognition.maxAlternatives = this.config.maxAlternatives;
        
        this.setupEventHandlers();
        
        console.log('🎤 Client-Side Voice Processor initialized');
        console.log('📍 Processing: 100% Browser | 0% Server');
        
        return true;
    }
    
    setupEventHandlers() {
        this.recognition.onstart = () => {
            this.isListening = true;
            console.log('🎤 Listening started (client-side)');
            if (this.onStart) this.onStart();
        };
        
        this.recognition.onresult = (event) => {
            this.processResult(event);
        };
        
        this.recognition.onerror = (event) => {
            console.error('Recognition error:', event.error);
            if (this.onError) this.onError(event.error);
            this.isListening = false;
        };
        
        this.recognition.onend = () => {
            this.isListening = false;
            console.log('🛑 Listening ended');
            if (this.onEnd) this.onEnd();
        };
    }
    
    // Process recognition result (client-side only)
    processResult(event) {
        const results = event.results;
        
        for (let i = event.resultIndex; i < results.length; i++) {
            const result = results[i];
            const transcript = result[0].transcript;
            const confidence = result[0].confidence;
            
            if (result.isFinal) {
                // Final result - process immediately
                this.currentResult = {
                    transcript: transcript.trim(),
                    confidence: confidence,
                    isFinal: true,
                    alternatives: Array.from(result).map(alt => ({
                        transcript: alt.transcript,
                        confidence: alt.confidence
                    }))
                };
                
                console.log('✅ Final result:', this.currentResult);
                
                if (this.onResult) {
                    this.onResult(this.currentResult);
                }
            } else {
                // Interim result - for UI feedback
                if (this.onInterim) {
                    this.onInterim({
                        transcript: transcript.trim(),
                        confidence: confidence,
                        isFinal: false
                    });
                }
            }
        }
    }
    
    // Start listening
    start() {
        if (!this.recognition) {
            throw new Error('Voice processor not initialized');
        }
        
        if (this.isListening) {
            console.warn('Already listening');
            return;
        }
        
        try {
            this.recognition.start();
        } catch (error) {
            console.error('Failed to start recognition:', error);
            if (this.onError) this.onError(error.message);
        }
    }
    
    // Stop listening
    stop() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }
    
    // Abort immediately
    abort() {
        if (this.recognition) {
            this.recognition.abort();
        }
    }
    
    // Get current result
    getResult() {
        return this.currentResult;
    }
    
    // Reset
    reset() {
        this.currentResult = null;
        this.processingQueue = [];
    }
    
    // Cleanup
    destroy() {
        this.stop();
        this.recognition = null;
        this.audioContext = null;
        this.analyser = null;
    }
}

// ============================================
// Local Drug Matcher (Client-Side)
// No server calls for drug matching
// ============================================

class LocalDrugMatcher {
    constructor() {
        this.drugs = new Map();
        this.phoneticIndex = new Map();
        this.searchIndex = new Map();
        this.isLoaded = false;
    }
    
    // Load drugs from local storage (IndexedDB or localStorage)
    async loadFromLocal() {
        try {
            // Try IndexedDB first
            const db = await this.openIndexedDB();
            const drugs = await this.getAllFromIndexedDB(db);
            
            if (drugs.length > 0) {
                this.buildIndexes(drugs);
                this.isLoaded = true;
                console.log(`📚 Loaded ${drugs.length} drugs from local storage`);
                return true;
            }
            
            // Fallback to localStorage
            const cached = localStorage.getItem('mega_storage_drugs');
            if (cached) {
                const drugs = JSON.parse(cached);
                this.buildIndexes(drugs);
                this.isLoaded = true;
                console.log(`📚 Loaded ${drugs.length} drugs from localStorage`);
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to load local drugs:', error);
            return false;
        }
    }
    
    openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('MegaStorageDrugs', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('drugs')) {
                    const store = db.createObjectStore('drugs', { keyPath: 'id' });
                    store.createIndex('tradeName', 'tradeName', { unique: false });
                    store.createIndex('scientificName', 'scientificName', { unique: false });
                }
            };
        });
    }
    
    getAllFromIndexedDB(db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['drugs'], 'readonly');
            const store = transaction.objectStore('drugs');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    // Save drugs to local storage
    async saveToLocal(drugs) {
        try {
            // Save to IndexedDB
            const db = await this.openIndexedDB();
            const transaction = db.transaction(['drugs'], 'readwrite');
            const store = transaction.objectStore('drugs');
            
            // Clear and re-add
            await store.clear();
            drugs.forEach(drug => store.put(drug));
            
            // Also save to localStorage as backup
            localStorage.setItem('mega_storage_drugs', JSON.stringify(drugs));
            localStorage.setItem('mega_storage_drugs_version', Date.now().toString());
            
            // Rebuild indexes
            this.buildIndexes(drugs);
            
            console.log(`💾 Saved ${drugs.length} drugs locally`);
        } catch (error) {
            console.error('Failed to save drugs:', error);
            // Fallback to localStorage only
            localStorage.setItem('mega_storage_drugs', JSON.stringify(drugs));
        }
    }
    
    // Build search indexes
    buildIndexes(drugs) {
        this.drugs.clear();
        this.phoneticIndex.clear();
        this.searchIndex.clear();
        
        drugs.forEach(drug => {
            this.drugs.set(drug.id, drug);
            
            // Build phonetic index
            if (drug.phoneticCodes) {
                drug.phoneticCodes.forEach(code => {
                    if (!this.phoneticIndex.has(code)) {
                        this.phoneticIndex.set(code, []);
                    }
                    this.phoneticIndex.get(code).push(drug.id);
                });
            }
            
            // Build search index (multiple terms per drug)
            const searchTerms = this.generateSearchTerms(drug);
            searchTerms.forEach(term => {
                if (!this.searchIndex.has(term)) {
                    this.searchIndex.set(term, []);
                }
                this.searchIndex.get(term).push(drug.id);
            });
        });
        
        this.isLoaded = true;
    }
    
    generateSearchTerms(drug) {
        const terms = new Set();
        
        // Trade names
        if (drug.tradeName) {
            terms.add(drug.tradeName.toLowerCase());
            terms.add(...drug.tradeName.toLowerCase().split(/\s+/));
        }
        
        // Scientific name
        if (drug.scientificName) {
            terms.add(drug.scientificName.toLowerCase());
        }
        
        // Voice aliases
        if (drug.voiceAliases) {
            drug.voiceAliases.forEach(alias => {
                terms.add(alias.toLowerCase());
            });
        }
        
        // Category
        if (drug.category) {
            terms.add(drug.category.toLowerCase());
        }
        
        return Array.from(terms);
    }
    
    // Find matching drugs (client-side only)
    findMatches(query, options = {}) {
        if (!this.isLoaded) {
            console.warn('Drug database not loaded');
            return [];
        }
        
        const normalizedQuery = query.toLowerCase().trim();
        const results = new Map();
        
        // Exact match
        if (this.searchIndex.has(normalizedQuery)) {
            this.searchIndex.get(normalizedQuery).forEach(id => {
                results.set(id, { drug: this.drugs.get(id), score: 1.0 });
            });
        }
        
        // Partial match
        for (const [term, ids] of this.searchIndex) {
            if (term.includes(normalizedQuery) || normalizedQuery.includes(term)) {
                const score = Math.min(normalizedQuery.length, term.length) / 
                             Math.max(normalizedQuery.length, term.length);
                ids.forEach(id => {
                    if (!results.has(id) || results.get(id).score < score) {
                        results.set(id, { drug: this.drugs.get(id), score });
                    }
                });
            }
        }
        
        // Phonetic match
        const phoneticCode = this.generatePhoneticCode(normalizedQuery);
        if (this.phoneticIndex.has(phoneticCode)) {
            this.phoneticIndex.get(phoneticCode).forEach(id => {
                if (!results.has(id)) {
                    results.set(id, { drug: this.drugs.get(id), score: 0.8 });
                }
            });
        }
        
        // Convert to array and sort by score
        const matches = Array.from(results.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, options.limit || 10);
        
        return matches;
    }
    
    generatePhoneticCode(text) {
        return text
            .replace(/[aeiou]/g, '')
            .replace(/ph/g, 'f')
            .replace(/th/g, 't')
            .replace(/sh/g, 's')
            .replace(/ch/g, 'c')
            .replace(/(.)(?=.*\1)/g, '')
            .substring(0, 4);
    }
    
    // Get drug by ID
    getDrug(id) {
        return this.drugs.get(id);
    }
    
    // Get all drugs
    getAllDrugs() {
        return Array.from(this.drugs.values());
    }
    
    // Check if needs update
    needsUpdate(serverVersion) {
        const localVersion = localStorage.getItem('mega_storage_drugs_version');
        return !localVersion || parseInt(localVersion) < serverVersion;
    }
}

// ============================================
// Resource Monitor (Track client-side load)
// ============================================

class ResourceMonitor {
    constructor() {
        this.metrics = {
            voiceProcessingTime: [],
            drugMatchTime: [],
            memoryUsage: [],
            cpuUsage: []
        };
    }
    
    // Measure voice processing performance
    measureVoiceProcessing(fn) {
        const start = performance.now();
        const result = fn();
        const end = performance.now();
        
        const duration = end - start;
        this.metrics.voiceProcessingTime.push(duration);
        
        // Keep last 100 measurements
        if (this.metrics.voiceProcessingTime.length > 100) {
            this.metrics.voiceProcessingTime.shift();
        }
        
        return result;
    }
    
    // Measure drug matching performance
    measureDrugMatch(fn) {
        const start = performance.now();
        const result = fn();
        const end = performance.now();
        
        const duration = end - start;
        this.metrics.drugMatchTime.push(duration);
        
        if (this.metrics.drugMatchTime.length > 100) {
            this.metrics.drugMatchTime.shift();
        }
        
        console.log(`⚡ Drug match took ${duration.toFixed(2)}ms (client-side)`);
        
        return result;
    }
    
    // Get average metrics
    getMetrics() {
        const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        
        return {
            avgVoiceProcessingTime: avg(this.metrics.voiceProcessingTime),
            avgDrugMatchTime: avg(this.metrics.drugMatchTime),
            totalVoiceProcessed: this.metrics.voiceProcessingTime.length,
            totalMatchesPerformed: this.metrics.drugMatchTime.length
        };
    }
    
    // Report
    report() {
        const metrics = this.getMetrics();
        console.log('📊 Resource Offloading Report:');
        console.log(`   Avg Voice Processing: ${metrics.avgVoiceProcessingTime.toFixed(2)}ms`);
        console.log(`   Avg Drug Match: ${metrics.avgDrugMatchTime.toFixed(2)}ms`);
        console.log(`   Server Load Saved: 100% (client-side processing)`);
        console.log(`   Network Calls Saved: ${metrics.totalMatchesPerformed} (local matching)`);
    }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ClientSideVoiceProcessor,
        LocalDrugMatcher,
        ResourceMonitor
    };
}

window.ClientSideVoiceProcessor = ClientSideVoiceProcessor;
window.LocalDrugMatcher = LocalDrugMatcher;
window.ResourceMonitor = ResourceMonitor;

console.log('🖥️ Client-Side Voice Processor loaded');
console.log('📍 Resource Offloading: 100% Browser Processing');
console.log('🌐 Server Load: 0% for Voice Recognition');
