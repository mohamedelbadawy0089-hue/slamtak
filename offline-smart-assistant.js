/**
 * Offline Smart Voice Assistant
 * Fully Offline Intent Classification using Transformers.js
 * 
 * Features:
 * - Speech-to-Intent: Web Speech API → Transformers.js Web Worker
 * - No API keys required
 * - No internet required after initial model load
 * - Non-blocking UI with Web Worker
 * - Gemini-style processing locally
 */

class OfflineSmartAssistant {
    constructor() {
        this.worker = null;
        this.isModelLoaded = false;
        this.isListening = false;
        this.isProcessing = false;
        this.recognition = null;
        this.pendingRequests = new Map();
        this.requestId = 0;
        this.intentHistory = [];
        this.confidenceThreshold = 0.6;
        
        // Fuse.js for phonetic matching
        this.fuse = null;
        this.drugDatabase = [];
        this.fuseOptions = {
            includeScore: true,
            threshold: 0.4,
            keys: ['tradeName', 'genericName', 'aliases', 'phoneticCode']
        };
        
        // Visual state callbacks
        this.onProcessingStart = null;
        this.onProcessingEnd = null;
        this.onSuccess = null;
        
        // Callbacks
        this.onIntentDetected = null;
        this.onListeningStart = null;
        this.onListeningEnd = null;
        this.onError = null;
        this.onModelStatus = null;
        
        // Auto-initialize
        this.initialize();
    }
    
    /**
     * Initialize the worker, speech recognition, and Fuse.js
     */
    async initialize() {
        console.log('🤖 Offline Smart Assistant initializing...');
        
        try {
            // Load Fuse.js
            await this.loadFuseJS();
            
            // Create Web Worker
            this.worker = new Worker('transformers-intent-worker.js');
            
            // Set up message handler
            this.worker.onmessage = (e) => this.handleWorkerMessage(e.data);
            this.worker.onerror = (err) => {
                console.error('Worker error:', err);
                if (this.onError) this.onError(err);
            };
            
            // Initialize speech recognition
            this.setupSpeechRecognition();
            
            // Load drug database for Fuse.js
            await this.loadDrugDatabase();
            
            console.log('✅ Offline Smart Assistant initialized');
            
        } catch (error) {
            console.error('❌ Failed to initialize:', error);
            if (this.onError) this.onError(error);
        }
    }
    
    /**
     * Load Fuse.js library
     */
    loadFuseJS() {
        return new Promise((resolve, reject) => {
            if (window.Fuse) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js';
            script.onload = () => {
                console.log('✅ Fuse.js loaded');
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load Fuse.js'));
            document.head.appendChild(script);
        });
    }
    
    /**
     * Load drug database for Fuse.js matching
     */
    async loadDrugDatabase() {
        try {
            // Try to get drugs from global variable or localStorage
            if (window.allDrugs && window.allDrugs.length > 0) {
                this.drugDatabase = window.allDrugs;
            } else if (window.globalDrugDatabase) {
                this.drugDatabase = window.globalDrugDatabase.getAllDrugs();
            } else {
                // Try localStorage
                const saved = localStorage.getItem('master_drugs');
                if (saved) {
                    this.drugDatabase = JSON.parse(saved);
                }
            }
            
            // Initialize Fuse
            if (this.drugDatabase.length > 0 && window.Fuse) {
                this.fuse = new Fuse(this.drugDatabase, this.fuseOptions);
                console.log(`✅ Fuse.js ready with ${this.drugDatabase.length} drugs`);
            }
        } catch (error) {
            console.error('❌ Failed to load drug database:', error);
        }
    }
    
    /**
     * Perform phonetic/fuzzy matching using Fuse.js
     */
    fuzzyMatchDrugName(drugName) {
        if (!this.fuse || !drugName) return null;
        
        const results = this.fuse.search(drugName);
        if (results.length > 0 && results[0].score < 0.4) {
            return {
                drug: results[0].item,
                score: results[0].score,
                matchedName: results[0].item.tradeName || results[0].item.name
            };
        }
        return null;
    }
    
    /**
     * Handle messages from Web Worker
     */
    handleWorkerMessage(data) {
        const { type, id, result, message, modelLoaded, error } = data;
        
        switch (type) {
            case 'ready':
                this.isModelLoaded = true;
                console.log('✅ AI Model ready:', message);
                if (this.onModelStatus) {
                    this.onModelStatus({ loaded: true, message });
                }
                break;
                
            case 'status':
                console.log('📊 Model status:', message);
                if (this.onModelStatus) {
                    this.onModelStatus({ loaded: this.isModelLoaded, message });
                }
                break;
                
            case 'classification':
                this.handleClassificationResult(id, result);
                break;
                
            case 'classification-batch':
                // Handle batch results
                result.forEach(item => {
                    this.handleClassificationResult(null, item);
                });
                break;
                
            case 'error':
                console.error('Worker error:', error || message);
                // Resolve pending request with error
                if (id && this.pendingRequests.has(id)) {
                    const { reject } = this.pendingRequests.get(id);
                    this.pendingRequests.delete(id);
                    reject(new Error(error || message));
                }
                if (this.onError) this.onError(new Error(error || message));
                break;
                
            case 'pong':
                console.log('Worker ping response:', { modelLoaded, cacheSize: data.cacheSize });
                break;
        }
    }
    
    /**
     * Handle classification result
     */
    handleClassificationResult(id, result) {
        // Resolve pending promise if exists
        if (id && this.pendingRequests.has(id)) {
            const { resolve } = this.pendingRequests.get(id);
            this.pendingRequests.delete(id);
            resolve(result);
        }
        
        // Add to history
        this.intentHistory.push({
            ...result,
            timestamp: Date.now()
        });
        
        // Keep history limited
        if (this.intentHistory.length > 50) {
            this.intentHistory.shift();
        }
        
        // Trigger callback
        if (this.onIntentDetected) {
            this.onIntentDetected(result);
        }
        
        console.log('🎯 Intent detected:', result.intent.intent, 
                    'Confidence:', result.intent.confidence.toFixed(2));
    }
    
    /**
     * Set up Web Speech API
     */
    setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.error('❌ Web Speech API not supported');
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        
        // Language based on context (can be changed)
        this.setLanguage('ar-SA'); // Default to Arabic
        
        this.recognition.onstart = () => {
            this.isListening = true;
            console.log('🎤 Listening started...');
            if (this.onListeningStart) this.onListeningStart();
        };
        
        this.recognition.onresult = async (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Show interim results
            if (interimTranscript && this.onIntentDetected) {
                this.onIntentDetected({
                    type: 'interim',
                    text: interimTranscript,
                    timestamp: Date.now()
                });
            }
            
            // Process final result with unified pipeline
            if (finalTranscript) {
                console.log('📝 Final transcript:', finalTranscript);
                await this.processUnifiedPipeline(finalTranscript);
            }
        };
        
        this.recognition.onerror = (event) => {
            console.error('🎤 Speech recognition error:', event.error);
            this.isListening = false;
            if (this.onError) this.onError(event);
        };
        
        this.recognition.onend = () => {
            this.isListening = false;
            console.log('🎤 Listening ended');
            if (this.onListeningEnd) this.onListeningEnd();
        };
    }
    
    /**
     * Set recognition language
     */
    setLanguage(lang) {
        if (this.recognition) {
            this.recognition.lang = lang;
        }
    }
    
    /**
     * Start listening for voice input
     */
    startListening(options = {}) {
        if (!this.recognition) {
            console.error('❌ Speech recognition not available');
            return Promise.reject(new Error('Speech recognition not available'));
        }
        
        if (this.isListening) {
            console.log('⚠️ Already listening');
            return Promise.resolve();
        }
        
        // Set language if specified
        if (options.language) {
            this.setLanguage(options.language);
        }
        
        // Set field context if specified
        if (options.field) {
            this.currentField = options.field;
            // Adjust language based on field
            if (options.field === 'productName') {
                this.setLanguage('en-US');
            } else {
                this.setLanguage('ar-SA');
            }
        }
        
        return new Promise((resolve, reject) => {
            try {
                this.recognition.start();
                this.listenResolve = resolve;
                this.listenReject = reject;
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Stop listening
     */
    stopListening() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }
    
    /**
     * Unified Voice Pipeline: Speech → Transformers → Fuse.js (fallback)
     * With visual confirmation states
     */
    async processUnifiedPipeline(transcript) {
        console.log('🔄 Starting unified pipeline for:', transcript);
        
        // Step 1: Visual feedback - Blue (Processing)
        this.isProcessing = true;
        if (this.onProcessingStart) this.onProcessingStart();
        
        try {
            // Step 2: Transformers.js Intent Classification
            const intentResult = await this.classifyIntent(transcript);
            
            // Step 3: Extract entities
            const entities = this.extractEntitiesEnhanced(transcript);
            
            // Step 4: Fuse.js Phonetic Matching (if drug name detected)
            let drugMatch = null;
            if (entities.drugName || entities.potentialDrugName) {
                drugMatch = this.fuzzyMatchDrugName(
                    entities.drugName || entities.potentialDrugName
                );
                
                if (drugMatch) {
                    console.log('✅ Fuse.js matched:', drugMatch.matchedName);
                    entities.drugName = drugMatch.matchedName;
                    entities.matchedDrug = drugMatch.drug;
                }
            }
            
            // Step 5: Prepare final result
            const result = {
                type: 'final',
                intent: intentResult.intent,
                entities: entities,
                confidence: intentResult.confidence,
                originalText: transcript,
                fuseMatch: drugMatch,
                timestamp: Date.now(),
                pipeline: {
                    transformers: true,
                    fuse: !!drugMatch
                }
            };
            
            // Add to history
            this.intentHistory.push(result);
            if (this.intentHistory.length > 50) {
                this.intentHistory.shift();
            }
            
            // Step 6: Visual feedback - Green (Success)
            this.isProcessing = false;
            if (this.onProcessingEnd) this.onProcessingEnd();
            if (this.onSuccess) this.onSuccess(result);
            if (this.onIntentDetected) this.onIntentDetected(result);
            
            console.log('✅ Pipeline complete:', result);
            return result;
            
        } catch (error) {
            console.error('❌ Pipeline failed:', error);
            this.isProcessing = false;
            if (this.onProcessingEnd) this.onProcessingEnd();
            if (this.onError) this.onError(error);
            
            // Fallback: Try Fuse.js directly
            const fuseResult = this.fuzzyMatchDrugName(transcript);
            if (fuseResult) {
                const fallbackResult = {
                    type: 'final',
                    intent: { intent: 'add_product', confidence: 0.7 },
                    entities: { drugName: fuseResult.matchedName },
                    confidence: 0.7,
                    originalText: transcript,
                    fuseMatch: fuseResult,
                    timestamp: Date.now(),
                    fallback: true
                };
                if (this.onIntentDetected) this.onIntentDetected(fallbackResult);
                return fallbackResult;
            }
            
            throw error;
        }
    }
    
    /**
     * Enhanced entity extraction
     */
    extractEntitiesEnhanced(text) {
        const entities = {
            quantity: null,
            drugName: null,
            potentialDrugName: null,
            price: null,
            dates: []
        };
        
        // Extract numbers (quantities)
        const numberMatches = text.match(/\b(\d+)\b/g);
        if (numberMatches) {
            // First number could be quantity, second could be price
            entities.quantity = parseInt(numberMatches[0]);
            if (numberMatches[1]) {
                entities.price = parseFloat(numberMatches[1]);
            }
        }
        
        // Extract Arabic numbers
        const arabicNumbers = {
            'صفر': 0, 'واحد': 1, 'واحدة': 1, 'اثنان': 2, 'اثنين': 2,
            'ثلاثة': 3, 'ثلاث': 3, 'أربعة': 4, 'أربع': 4,
            'خمسة': 5, 'خمس': 5, 'ستة': 6, 'ست': 6,
            'سبعة': 7, 'سبع': 7, 'ثمانية': 8, 'ثمان': 8,
            'تسعة': 9, 'تسع': 9, 'عشرة': 10, 'عشر': 10,
            'عشرين': 20, 'ثلاثين': 30, 'أربعين': 40,
            'خمسين': 50, 'مئة': 100, 'مية': 100, 'ألف': 1000
        };
        
        for (const [word, num] of Object.entries(arabicNumbers)) {
            if (text.includes(word)) {
                entities.quantity = num;
                break;
            }
        }
        
        // Extract English drug names (capitalized words)
        const drugNameMatch = text.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\b/);
        if (drugNameMatch) {
            entities.drugName = drugNameMatch[1];
        }
        
        // Extract potential drug names (any capitalized word)
        const potentialMatch = text.match(/\b[A-Z][a-z]+\b/);
        if (potentialMatch && !entities.drugName) {
            entities.potentialDrugName = potentialMatch[0];
        }
        
        // Extract price patterns
        const priceMatch = text.match(/(\d+(?:\.\d+)?)\s*(جنيه|ج|egp|pound)/i);
        if (priceMatch) {
            entities.price = parseFloat(priceMatch[1]);
        }
        
        // Extract dates
        const dateMatches = text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g);
        if (dateMatches) {
            entities.dates = dateMatches;
        }
        
        return entities;
    }
    
    /**
     * Classify text intent (can be called directly without speech)
     */
    classifyIntent(text) {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('Worker not initialized'));
                return;
            }
            
            const id = ++this.requestId;
            this.pendingRequests.set(id, { resolve, reject });
            
            // Send to worker
            this.worker.postMessage({
                type: 'classify',
                id,
                payload: { text }
            });
            
            // Timeout after 5 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Classification timeout'));
                }
            }, 5000);
        });
    }
    
    /**
     * Process voice command with full pipeline
     * Speech → Text → Intent → Action
     */
    async processVoiceCommand(options = {}) {
        try {
            // Start listening
            await this.startListening(options);
            
            // Wait for result (handled in onresult callback)
            return new Promise((resolve) => {
                const checkResult = setInterval(() => {
                    // Check if we have recent results
                    const recent = this.intentHistory.filter(
                        h => Date.now() - h.timestamp < 10000
                    );
                    
                    if (recent.length > 0) {
                        clearInterval(checkResult);
                        resolve(recent[recent.length - 1]);
                    }
                }, 100);
                
                // Timeout after 10 seconds
                setTimeout(() => {
                    clearInterval(checkResult);
                    this.stopListening();
                    resolve(null);
                }, 10000);
            });
            
        } catch (error) {
            console.error('❌ Voice command processing failed:', error);
            throw error;
        }
    }
    
    /**
     * Execute action based on detected intent
     */
    executeIntent(result, context = {}) {
        const { intent, entities } = result;
        const intentType = intent.intent;
        const confidence = intent.confidence;
        
        // Check confidence threshold
        if (confidence < this.confidenceThreshold) {
            console.log('⚠️ Low confidence, asking for clarification');
            return {
                success: false,
                action: 'clarify',
                message: 'لم أفهم جيداً، هل تقصد إضافة منتج جديد؟'
            };
        }
        
        // Execute based on intent type
        switch (intentType) {
            case 'add_product':
                return this.executeAddProduct(entities, context);
                
            case 'update_quantity':
                return this.executeUpdateQuantity(entities, context);
                
            case 'search_product':
                return this.executeSearchProduct(entities, context);
                
            case 'delete_product':
                return this.executeDeleteProduct(entities, context);
                
            case 'show_inventory':
                return this.executeShowInventory(context);
                
            case 'check_expiry':
                return this.executeCheckExpiry(entities, context);
                
            default:
                return {
                    success: false,
                    action: 'unknown',
                    message: 'لم أفهم الأمر، يمكنك قول "أضف منتج" أو "ابحث عن دواء"'
                };
        }
    }
    
    /**
     * Execute add product intent
     */
    executeAddProduct(entities, context) {
        const drugName = entities.drugName || context.currentProduct || '';
        const quantity = entities.quantity || 1;
        
        return {
            success: true,
            action: 'add_product',
            data: {
                productName: drugName,
                quantity: quantity,
                price: entities.price || null
            },
            message: `سأضيف ${drugName || 'المنتج'} بكمية ${quantity}`
        };
    }
    
    /**
     * Execute update quantity intent
     */
    executeUpdateQuantity(entities, context) {
        const drugName = entities.drugName || context.currentProduct || '';
        const quantity = entities.quantity;
        
        return {
            success: true,
            action: 'update_quantity',
            data: {
                productName: drugName,
                quantity: quantity
            },
            message: quantity 
                ? `سأحدث كمية ${drugName || 'المنتج'} إلى ${quantity}`
                : `سأفتح تعديل الكمية لـ ${drugName || 'المنتج'}`
        };
    }
    
    /**
     * Execute search product intent
     */
    executeSearchProduct(entities, context) {
        const drugName = entities.drugName || context.searchQuery || '';
        
        return {
            success: true,
            action: 'search_product',
            data: {
                productName: drugName
            },
            message: `سأبحث عن ${drugName || 'المنتج'}`
        };
    }
    
    /**
     * Execute delete product intent
     */
    executeDeleteProduct(entities, context) {
        const drugName = entities.drugName || context.currentProduct || '';
        
        return {
            success: true,
            action: 'delete_product',
            data: {
                productName: drugName
            },
            message: `سأحذف ${drugName || 'المنتج'}`
        };
    }
    
    /**
     * Execute show inventory intent
     */
    executeShowInventory(context) {
        return {
            success: true,
            action: 'show_inventory',
            data: {},
            message: 'سأعرض لك المخزون'
        };
    }
    
    /**
     * Execute check expiry intent
     */
    executeCheckExpiry(entities, context) {
        const drugName = entities.drugName || context.currentProduct || '';
        
        return {
            success: true,
            action: 'check_expiry',
            data: {
                productName: drugName,
                dates: entities.dates
            },
            message: drugName 
                ? `سأفحص صلاحية ${drugName}`
                : 'سأعرض الأدوية المنتهية الصلاحية'
        };
    }
    
    /**
     * Get model status
     */
    getStatus() {
        return {
            modelLoaded: this.isModelLoaded,
            isListening: this.isListening,
            historyCount: this.intentHistory.length,
            workerActive: !!this.worker
        };
    }
    
    /**
     * Ping the worker to check if it's alive
     */
    ping() {
        if (this.worker) {
            this.worker.postMessage({ type: 'ping' });
        }
    }
    
    /**
     * Clear intent cache
     */
    clearCache() {
        if (this.worker) {
            this.worker.postMessage({ type: 'clear-cache' });
        }
        this.intentHistory = [];
    }
    
    /**
     * Destroy the assistant
     */
    destroy() {
        this.stopListening();
        
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        
        this.pendingRequests.clear();
        this.intentHistory = [];
    }
}

// Create global instance
window.OfflineSmartAssistant = OfflineSmartAssistant;

// Auto-create default instance
window.offlineAssistant = new OfflineSmartAssistant();

console.log('✅ Offline Smart Assistant loaded');
