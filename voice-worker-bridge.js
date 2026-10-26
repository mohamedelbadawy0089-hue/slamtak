// ============================================
// Voice-Worker Bridge
// Direct pipeline: Voice Recognition -> Worker -> UI
// Zero UI blocking | 60fps Guaranteed
// ============================================

class VoiceWorkerBridge {
    constructor(config = {}) {
        this.config = {
            workerUrl: config.workerUrl || 'storage-worker.js',
            confidenceThreshold: config.confidenceThreshold || 0.6,
            maxAlternatives: config.maxAlternatives || 5,
            language: config.language || 'en-US',
            ...config
        };
        
        // Worker instance
        this.worker = null;
        this.workerManager = null;
        
        // Voice recognition
        this.recognition = null;
        this.isListening = false;
        
        // State
        this.pendingOperations = new Map();
        this.operationId = 0;
        
        // Callbacks
        this.onVoiceResult = null;
        this.onVoiceInterim = null;
        this.onMatchFound = null;
        this.onNoMatch = null;
        this.onError = null;
        
        // Stats
        this.stats = {
            voiceQueries: 0,
            matchesFound: 0,
            avgMatchTime: 0,
            cacheHits: 0
        };
        
        // Ready state
        this.isReady = false;
    }
    
    // Initialize bridge
    async initialize() {
        console.log('🎤🧵 Initializing Voice-Worker Bridge...');
        
        try {
            // Initialize Worker Manager
            this.workerManager = new WorkerStorageManager(this.config.workerUrl);
            await this.workerManager.initialize();
            
            // Initialize Voice Recognition
            await this.initializeVoiceRecognition();
            
            this.isReady = true;
            
            console.log('✅ Voice-Worker Bridge ready');
            console.log('🎤 Voice: Browser API');
            console.log('🧵 Processing: Worker Thread');
            console.log('🎮 UI: 60fps Unblocked');
            
            return true;
        } catch (error) {
            console.error('❌ Bridge initialization failed:', error);
            this.onError?.(error);
            return false;
        }
    }
    
    // Initialize Web Speech API
    async initializeVoiceRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            throw new Error('Web Speech API not supported. Use Chrome or Edge.');
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = this.config.language;
        this.recognition.maxAlternatives = this.config.maxAlternatives;
        
        this.recognition.onstart = () => {
            this.isListening = true;
            console.log('🎤 Voice recognition started');
        };
        
        this.recognition.onresult = (event) => {
            this.handleVoiceResult(event);
        };
        
        this.recognition.onerror = (event) => {
            console.error('Voice recognition error:', event.error);
            this.onError?.(event.error);
            this.isListening = false;
        };
        
        this.recognition.onend = () => {
            this.isListening = false;
        };
    }
    
    // Handle voice recognition result
    handleVoiceResult(event) {
        const results = event.results;
        
        for (let i = event.resultIndex; i < results.length; i++) {
            const result = results[i];
            const transcript = result[0].transcript.trim();
            const confidence = result[0].confidence;
            
            if (result.isFinal) {
                // Final result - send to worker for matching
                this.processFinalResult(transcript, confidence, result);
            } else {
                // Interim result - update UI immediately
                this.onVoiceInterim?.({
                    transcript,
                    confidence,
                    isFinal: false
                });
            }
        }
    }
    
    // Process final voice result in worker
    async processFinalResult(transcript, confidence, rawResult) {
        console.log('🎤 Voice:', transcript);
        this.stats.voiceQueries++;
        
        const startTime = performance.now();
        
        // Send to UI callback immediately
        this.onVoiceResult?.({
            transcript,
            confidence,
            isFinal: true,
            alternatives: Array.from(rawResult).map(alt => ({
                transcript: alt.transcript,
                confidence: alt.confidence
            }))
        });
        
        // Offload matching to worker
        try {
            const matches = await this.findMatchesInWorker(transcript);
            
            const matchTime = performance.now() - startTime;
            this.updateMatchStats(matchTime);
            
            if (matches.length > 0 && matches[0]._matchScore >= this.config.confidenceThreshold) {
                this.stats.matchesFound++;
                this.onMatchFound?.({
                    drug: matches[0],
                    matches: matches,
                    voiceInput: transcript,
                    confidence: matches[0]._matchScore,
                    matchTime
                });
            } else {
                this.onNoMatch?.({
                    voiceInput: transcript,
                    attemptedMatches: matches,
                    message: 'No matching drug found'
                });
            }
        } catch (error) {
            console.error('Worker matching error:', error);
            this.onError?.(error);
        }
    }
    
    // Find matches in worker thread
    async findMatchesInWorker(query) {
        // Send search operation to worker
        return this.workerManager.search('drugs', 'tradeName', query, {
            limit: this.config.maxAlternatives,
            threshold: 0.4
        });
    }
    
    // Start voice recognition
    start() {
        if (!this.recognition || this.isListening) return;
        
        try {
            this.recognition.start();
        } catch (error) {
            console.error('Failed to start recognition:', error);
        }
    }
    
    // Stop voice recognition
    stop() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }
    
    // Toggle voice recognition
    toggle() {
        if (this.isListening) {
            this.stop();
        } else {
            this.start();
        }
    }
    
    // Update match statistics
    updateMatchStats(matchTime) {
        const alpha = 0.1;
        this.stats.avgMatchTime = 
            (alpha * matchTime) + ((1 - alpha) * this.stats.avgMatchTime);
    }
    
    // Get bridge statistics
    getStats() {
        return {
            ...this.stats,
            isReady: this.isReady,
            isListening: this.isListening,
            cacheHitRate: this.workerManager?.getStats()?.cacheHitRate || '0%'
        };
    }
    
    // Preload drug encyclopedia in background
    async preloadEncyclopedia(drugs) {
        console.log('📚 Preloading encyclopedia in worker...');
        
        try {
            // Load drugs in worker
            const result = await this.workerManager.bulkInsert('drugs', drugs, {
                batchSize: 1000,
                onProgress: (progress) => {
                    console.log(`📚 Loading: ${progress.progress}%`);
                }
            });
            
            // Build phonetic index in worker
            await this.workerManager.buildIndex(drugs, (progress) => {
                console.log(`🔤 Indexing: ${progress.progress}%`);
            });
            
            console.log('✅ Encyclopedia ready:', result.completed, 'drugs');
            return result;
        } catch (error) {
            console.error('❌ Failed to preload encyclopedia:', error);
            throw error;
        }
    }
    
    // Check if specific drug exists
    async checkDrug(drugId) {
        return this.workerManager.get('drugs', drugId);
    }
    
    // Get all loaded drugs count
    async getDrugCount() {
        return this.workerManager.count('drugs');
    }
    
    // Destroy bridge
    destroy() {
        this.stop();
        this.workerManager?.destroy();
        this.worker = null;
        this.recognition = null;
    }
}

// ============================================
// National Scale Deployment Loader
// Instant-ready system with background loading
// ============================================

class NationalDeploymentLoader {
    constructor(config = {}) {
        this.config = {
            encyclopediaUrl: config.encyclopediaUrl || '/api/encyclopedia',
            fallbackDrugs: config.fallbackDrugs || [],
            preloadInBackground: config.preloadInBackground !== false,
            ...config
        };
        
        this.bridge = null;
        this.isReady = false;
        this.loadingState = {
            phase: 'initializing', // initializing, loading, indexing, ready
            progress: 0,
            loadedDrugs: 0,
            totalDrugs: 0
        };
        
        this.onReady = null;
        this.onLoadingProgress = null;
        this.onError = null;
    }
    
    // Initialize for immediate use
    async initialize() {
        console.log('🚀 National Deployment: Initializing...');
        
        try {
            // Phase 1: Initialize bridge (instant)
            this.loadingState.phase = 'initializing';
            this.bridge = new VoiceWorkerBridge();
            await this.bridge.initialize();
            
            // Phase 2: Load minimal dataset for immediate use
            this.loadingState.phase = 'loading';
            const minimalDrugs = this.getMinimalDataset();
            await this.bridge.preloadEncyclopedia(minimalDrugs);
            
            this.loadingState.loadedDrugs = minimalDrugs.length;
            this.loadingState.progress = 30;
            this.onLoadingProgress?.(this.loadingState);
            
            // System is now ready for use
            this.isReady = true;
            this.onReady?.({
                ready: true,
                drugsAvailable: minimalDrugs.length,
                fullDataset: false
            });
            
            console.log('✅ System ready! Basic encyclopedia loaded.');
            console.log('🎤 Voice recognition active');
            console.log('📚 Full encyclopedia loading in background...');
            
            // Phase 3: Load full encyclopedia in background
            if (this.config.preloadInBackground) {
                this.loadFullEncyclopediaInBackground();
            }
            
            return true;
        } catch (error) {
            console.error('❌ Deployment initialization failed:', error);
            this.onError?.(error);
            return false;
        }
    }
    
    // Get minimal dataset for immediate use
    getMinimalDataset() {
        // Essential drugs for immediate use
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
    
    // Load full encyclopedia in background
    async loadFullEncyclopediaInBackground() {
        try {
            console.log('📚 Loading full encyclopedia in background...');
            
            // Try to fetch from server
            let fullDrugs = [];
            
            try {
                const response = await fetch(this.config.encyclopediaUrl);
                if (response.ok) {
                    fullDrugs = await response.json();
                }
            } catch (error) {
                console.warn('⚠️ Could not fetch from server, using fallback');
                fullDrugs = this.config.fallbackDrugs;
            }
            
            if (fullDrugs.length === 0) {
                console.log('📚 No additional drugs to load');
                return;
            }
            
            this.loadingState.totalDrugs = fullDrugs.length;
            
            // Load in chunks to allow UI breathing
            const chunkSize = 5000;
            let loaded = 0;
            
            for (let i = 0; i < fullDrugs.length; i += chunkSize) {
                const chunk = fullDrugs.slice(i, i + chunkSize);
                
                await this.bridge.workerManager.bulkInsert('drugs', chunk, {
                    batchSize: 1000,
                    onProgress: (progress) => {
                        // Silent progress
                    }
                });
                
                loaded += chunk.length;
                this.loadingState.loadedDrugs = loaded;
                this.loadingState.progress = 30 + Math.round((loaded / fullDrugs.length) * 70);
                
                // Allow event loop to breathe
                await new Promise(resolve => setTimeout(resolve, 0));
                
                this.onLoadingProgress?.(this.loadingState);
            }
            
            // Rebuild index with full dataset
            this.loadingState.phase = 'indexing';
            await this.bridge.workerManager.buildIndex(fullDrugs);
            
            this.loadingState.phase = 'ready';
            this.loadingState.progress = 100;
            
            console.log('✅ Full encyclopedia ready:', fullDrugs.length, 'drugs');
            this.onLoadingProgress?.(this.loadingState);
            
        } catch (error) {
            console.error('❌ Background loading failed:', error);
        }
    }
    
    // Get voice bridge instance
    getBridge() {
        return this.bridge;
    }
    
    // Check if system is ready
    isSystemReady() {
        return this.isReady;
    }
    
    // Get loading state
    getLoadingState() {
        return this.loadingState;
    }
    
    // Get stats
    getStats() {
        return {
            ...this.bridge?.getStats(),
            loadingState: this.loadingState,
            isReady: this.isReady
        };
    }
    
    // Destroy
    destroy() {
        this.bridge?.destroy();
        this.bridge = null;
        this.isReady = false;
    }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        VoiceWorkerBridge,
        NationalDeploymentLoader
    };
}

window.VoiceWorkerBridge = VoiceWorkerBridge;
window.NationalDeploymentLoader = NationalDeploymentLoader;

console.log('🎤🧵 Voice-Worker Bridge loaded');
console.log('⚡ 60fps Voice Recognition Pipeline');
console.log('🚀 National Scale: Instant Ready');
