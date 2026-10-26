/**
 * Google Assistant-Style Advanced Voice System
 * Fully Local - No API Keys Required
 * 
 * Features:
 * - Continuous/Persistent Listening
 * - Waveform Visualization (Google Assistant style)
 * - Advanced NLU with Transformers.js
 * - Bulk Fill all form fields
 * - Voice confirmation with SpeechSynthesis
 * - 100% Local Execution
 */

class GoogleAssistantVoiceSystem {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.isProcessing = false;
        this.isContinuousMode = false;
        this.currentTranscript = '';
        this.pendingCommand = null;
        
        // Transformers.js
        this.worker = null;
        this.isModelLoaded = false;
        this.requestId = 0;
        this.pendingRequests = new Map();
        
        // Fuse.js
        this.fuse = null;
        this.drugDatabase = [];
        this.fuseOptions = {
            includeScore: true,
            threshold: 0.3,
            keys: ['tradeName', 'genericName', 'aliases', 'phoneticCode', 'voiceAliases']
        };
        
        // Audio Context for waveform
        this.audioContext = null;
        this.analyser = null;
        this.microphoneStream = null;
        this.dataArray = null;
        
        // Callbacks
        this.onWaveformUpdate = null;
        this.onListeningStateChange = null;
        this.onCommandRecognized = null;
        this.onBulkFillComplete = null;
        this.onVoiceConfirmation = null;
        
        // Auto-initialize
        this.initialize();
    }
    
    /**
     * Initialize the system
     */
    async initialize() {
        console.log('🎙️ Google Assistant Voice System initializing...');
        
        try {
            // Load dependencies
            await this.loadDependencies();
            
            // Initialize Web Worker
            this.setupWorker();
            
            // Initialize Speech Recognition
            this.setupSpeechRecognition();
            
            // Load drug database for Fuse.js
            await this.loadDrugDatabase();
            
            // Initialize Audio Context for waveform
            this.setupAudioContext();
            
            console.log('✅ Google Assistant Voice System ready');
            this.speak('النظام الصوتي جاهز');
            
        } catch (error) {
            console.error('❌ Initialization failed:', error);
        }
    }
    
    /**
     * Load all required libraries
     */
    loadDependencies() {
        return new Promise((resolve, reject) => {
            const scripts = [
                'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js'
            ];
            
            let loaded = 0;
            scripts.forEach(src => {
                if (window.Fuse) {
                    loaded++;
                    if (loaded === scripts.length) resolve();
                    return;
                }
                
                const script = document.createElement('script');
                script.src = src;
                script.onload = () => {
                    loaded++;
                    if (loaded === scripts.length) resolve();
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
            
            // If already loaded
            if (loaded === scripts.length || window.Fuse) {
                resolve();
            }
        });
    }
    
    /**
     * Setup Web Worker for Transformers.js
     */
    setupWorker() {
        try {
            this.worker = new Worker('transformers-intent-worker.js');
            
            this.worker.onmessage = (e) => {
                const { type, id, result, modelLoaded, message } = e.data;
                
                switch (type) {
                    case 'ready':
                        this.isModelLoaded = true;
                        console.log('✅ AI Model loaded');
                        break;
                        
                    case 'classification':
                        if (this.pendingRequests.has(id)) {
                            this.pendingRequests.get(id).resolve(result);
                            this.pendingRequests.delete(id);
                        }
                        break;
                        
                    case 'error':
                        console.error('Worker error:', message);
                        break;
                }
            };
            
            this.worker.onerror = (err) => {
                console.error('Worker error:', err);
            };
            
        } catch (error) {
            console.error('❌ Worker setup failed:', error);
        }
    }
    
    /**
     * Setup Web Speech API with continuous mode
     */
    setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.error('❌ Web Speech API not supported');
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true; // Continuous listening
        this.recognition.interimResults = true;
        this.recognition.lang = 'ar-SA';
        this.recognition.maxAlternatives = 1;
        
        this.recognition.onstart = () => {
            this.isListening = true;
            console.log('🎤 Continuous listening started');
            if (this.onListeningStateChange) {
                this.onListeningStateChange('listening');
            }
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
            
            // Show interim results with waveform
            if (interimTranscript && this.onWaveformUpdate) {
                this.onWaveformUpdate('listening', interimTranscript);
            }
            
            // Process final result
            if (finalTranscript) {
                console.log('📝 Command:', finalTranscript);
                this.currentTranscript = finalTranscript;
                await this.processCommand(finalTranscript);
            }
        };
        
        this.recognition.onerror = (event) => {
            console.error('🎤 Speech error:', event.error);
            
            // Restart on error if in continuous mode
            if (this.isContinuousMode && event.error !== 'aborted') {
                setTimeout(() => {
                    if (!this.isListening) {
                        this.startContinuousListening();
                    }
                }, 500);
            }
        };
        
        this.recognition.onend = () => {
            this.isListening = false;
            console.log('🎤 Listening ended');
            
            // Restart if in continuous mode
            if (this.isContinuousMode) {
                setTimeout(() => this.startContinuousListening(), 100);
            } else {
                if (this.onListeningStateChange) {
                    this.onListeningStateChange('idle');
                }
            }
        };
    }
    
    /**
     * Setup Audio Context for real waveform visualization
     */
    setupAudioContext() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
        } catch (error) {
            console.warn('Audio context not supported, using CSS fallback');
        }
    }
    
    /**
     * Connect microphone to audio context for real waveform
     */
    async connectMicrophone() {
        if (!this.audioContext) return;
        
        try {
            this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = this.audioContext.createMediaStreamSource(this.microphoneStream);
            source.connect(this.analyser);
            
            // Start waveform animation
            this.animateWaveform();
            
        } catch (error) {
            console.warn('Microphone access denied, using CSS fallback');
        }
    }
    
    /**
     * Animate waveform based on audio data
     */
    animateWaveform() {
        if (!this.analyser || !this.isListening) return;
        
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Calculate average volume for visualization
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        const average = sum / this.dataArray.length;
        
        // Update waveform visualization
        if (this.onWaveformUpdate) {
            this.onWaveformUpdate('visualizing', null, average);
        }
        
        requestAnimationFrame(() => this.animateWaveform());
    }
    
    /**
     * Start continuous listening mode
     */
    startContinuousListening() {
        if (!this.recognition) {
            console.error('❌ Speech recognition not available');
            return Promise.reject(new Error('Speech recognition not available'));
        }
        
        this.isContinuousMode = true;
        
        // Connect microphone for waveform
        this.connectMicrophone();
        
        return new Promise((resolve, reject) => {
            try {
                this.recognition.start();
                console.log('🎤 Continuous listening activated');
                this.speak('أنا أستمع');
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Stop continuous listening
     */
    stopContinuousListening() {
        this.isContinuousMode = false;
        
        if (this.recognition) {
            this.recognition.stop();
        }
        
        // Disconnect microphone
        if (this.microphoneStream) {
            this.microphoneStream.getTracks().forEach(track => track.stop());
            this.microphoneStream = null;
        }
        
        console.log('🎤 Continuous listening stopped');
    }
    
    /**
     * Process voice command with full pipeline
     */
    async processCommand(transcript) {
        console.log('🔄 Processing command:', transcript);
        
        // Visual feedback - processing
        this.isProcessing = true;
        if (this.onListeningStateChange) {
            this.onListeningStateChange('processing');
        }
        
        try {
            // Step 1: Transformers.js NLU
            const nluResult = await this.nluProcess(transcript);
            
            // Step 2: Extract all entities
            const entities = this.extractAllEntities(transcript);
            
            // Step 3: Fuse.js Global Correction for drug names
            const corrections = await this.globalCorrection(entities);
            
            // Step 4: Prepare bulk fill data
            const bulkData = this.prepareBulkFill(corrections);
            
            // Step 5: Execute bulk fill
            const fillResult = await this.executeBulkFill(bulkData);
            
            // Step 6: Voice confirmation
            const confirmationMessage = this.generateConfirmationMessage(fillResult);
            this.speak(confirmationMessage);
            
            // Visual feedback - success
            this.isProcessing = false;
            if (this.onListeningStateChange) {
                this.onListeningStateChange('success');
            }
            
            if (this.onCommandRecognized) {
                this.onCommandRecognized({
                    transcript,
                    nlu: nluResult,
                    entities: corrections,
                    fillResult,
                    confirmationMessage
                });
            }
            
            return fillResult;
            
        } catch (error) {
            console.error('❌ Command processing failed:', error);
            this.isProcessing = false;
            if (this.onListeningStateChange) {
                this.onListeningStateChange('error');
            }
            this.speak('عذراً، لم أفهم. حاول مرة أخرى');
            throw error;
        }
    }
    
    /**
     * Natural Language Understanding with Transformers.js
     */
    nluProcess(text) {
        return new Promise((resolve, reject) => {
            if (!this.worker || !this.isModelLoaded) {
                // Fallback to pattern matching
                resolve(this.fallbackNLU(text));
                return;
            }
            
            const id = ++this.requestId;
            this.pendingRequests.set(id, { resolve, reject });
            
            this.worker.postMessage({
                type: 'classify',
                id,
                payload: { text }
            });
            
            // Timeout
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    resolve(this.fallbackNLU(text));
                }
            }, 3000);
        });
    }
    
    /**
     * Fallback NLU using pattern matching
     */
    fallbackNLU(text) {
        const lower = text.toLowerCase();
        
        // Complex sentence patterns
        const patterns = {
            add_product: ['ضيف', 'أضف', 'سجل', 'حط', 'جديد', 'add', 'new'],
            update_quantity: ['غير', 'عدل', 'تحديث', 'زيادة', 'نقص', 'update', 'change'],
            search: ['دور', 'ابحث', 'فين', 'وين', 'search', 'find'],
            delete: ['امسح', 'شيل', 'حذف', 'شطب', 'delete', 'remove'],
            show_inventory: ['عرض', 'أرني', 'استعرض', 'show', 'display']
        };
        
        for (const [intent, words] of Object.entries(patterns)) {
            for (const word of words) {
                if (lower.includes(word)) {
                    return { intent, confidence: 0.8, source: 'fallback' };
                }
            }
        }
        
        return { intent: 'unknown', confidence: 0.3, source: 'fallback' };
    }
    
    /**
     * Extract all entities from text
     */
    extractAllEntities(text) {
        const entities = {
            drugName: null,
            quantity: null,
            price: null,
            expiryDate: null,
            confidence: 0
        };
        
        // Extract drug name - look for capitalized words or words after "دواء" or "علاج"
        const drugPatterns = [
            /(?:دواء|علاج|دوا|ادوية?)\s+([A-Za-z][A-Za-z0-9\s]+)/i,
            /(?:اسم|يسمى|اسمه)\s+([A-Za-z][A-Za-z0-9\s]+)/i,
            /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/ // Capitalized words
        ];
        
        for (const pattern of drugPatterns) {
            const match = text.match(pattern);
            if (match) {
                entities.drugName = match[1].trim();
                break;
            }
        }
        
        // Extract quantity
        const qtyPatterns = [
            /(\d+)\s*(?:علبة|علب|شريط|شرائط|كرتونة|كرتون|قرص|اقراص|حبة|حبات|unit|units?)/i,
            /(?:كمية|عدد|بكمية|عدده|quantity)\s*(?:هي)?\s*(\d+)/i,
            /\b(\d+)\b/
        ];
        
        for (const pattern of qtyPatterns) {
            const match = text.match(pattern);
            if (match) {
                entities.quantity = parseInt(match[1]);
                break;
            }
        }
        
        // Extract price
        const pricePatterns = [
            /(?:بسعر|سعره|سعر|price)\s*(?:هو)?\s*(\d+(?:\.\d+)?)/i,
            /(\d+(?:\.\d+)?)\s*(?:جنيه|جنية|ج\.|ج\s|pound|egp)/i
        ];
        
        for (const pattern of pricePatterns) {
            const match = text.match(pattern);
            if (match) {
                entities.price = parseFloat(match[1]);
                break;
            }
        }
        
        // Extract expiry date
        const datePatterns = [
            /(?:تاريخ انتهاء|صلاحية|ينتهي|expiry|expires?)\s*(?:هو)?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
            /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/
        ];
        
        for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
                entities.expiryDate = match[1];
                break;
            }
        }
        
        return entities;
    }
    
    /**
     * Global Correction using Fuse.js
     */
    async globalCorrection(entities) {
        const corrected = { ...entities };
        
        if (entities.drugName && this.fuse) {
            const results = this.fuse.search(entities.drugName);
            
            if (results.length > 0 && results[0].score < 0.4) {
                const match = results[0].item;
                corrected.drugName = match.tradeName || match.name;
                corrected.matchedDrug = match;
                corrected.correctionConfidence = 1 - results[0].score;
                console.log(`✅ Corrected: ${entities.drugName} → ${corrected.drugName}`);
            }
        }
        
        return corrected;
    }
    
    /**
     * Prepare bulk fill data
     */
    prepareBulkFill(entities) {
        return {
            productName: entities.drugName,
            quantity: entities.quantity,
            priceInt: entities.price ? Math.floor(entities.price) : null,
            priceFrac: entities.price ? Math.round((entities.price % 1) * 100) : null,
            expiryDate: entities.expiryDate,
            confidence: entities.correctionConfidence || 0.5
        };
    }
    
    /**
     * Execute bulk fill on form fields
     */
    async executeBulkFill(data) {
        const filled = [];
        const failed = [];
        
        // Fill product name
        if (data.productName) {
            const el = document.getElementById('productName');
            if (el) {
                el.value = data.productName;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                filled.push('اسم المنتج');
            } else {
                failed.push('اسم المنتج');
            }
        }
        
        // Fill quantity
        if (data.quantity) {
            const el = document.getElementById('quantity');
            if (el) {
                el.value = data.quantity;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                filled.push('الكمية');
            }
        }
        
        // Fill price
        if (data.priceInt !== null) {
            const intEl = document.getElementById('priceInt');
            const fracEl = document.getElementById('priceFrac');
            if (intEl) {
                intEl.value = data.priceInt;
                intEl.dispatchEvent(new Event('input', { bubbles: true }));
                filled.push('السعر');
            }
            if (fracEl && data.priceFrac) {
                fracEl.value = data.priceFrac;
                fracEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        
        // Fill expiry date
        if (data.expiryDate) {
            const el = document.getElementById('expiryDate');
            if (el) {
                el.value = data.expiryDate;
                filled.push('تاريخ الصلاحية');
            }
        }
        
        // Trigger validation if available
        if (typeof validateForm === 'function') {
            validateForm();
        }
        
        if (this.onBulkFillComplete) {
            this.onBulkFillComplete({ filled, failed, data });
        }
        
        return { filled, failed, data, success: filled.length > 0 };
    }
    
    /**
     * Generate voice confirmation message
     */
    generateConfirmationMessage(result) {
        const { filled, data } = result;
        
        if (filled.length === 0) {
            return 'لم أتمكن من ملء أي بيانات';
        }
        
        let message = `تم ملء ${filled.join(' و')}`;
        
        if (data.productName) {
            message += `. المنتج ${data.productName}`;
        }
        
        if (data.quantity) {
            message += `. الكمية ${data.quantity}`;
        }
        
        if (data.priceInt !== null) {
            message += `. السعر ${data.priceInt}`;
            if (data.priceFrac) {
                message += ` و ${data.priceFrac} قرش`;
            }
        }
        
        return message;
    }
    
    /**
     * Voice output using SpeechSynthesis
     */
    speak(text) {
        if (!('speechSynthesis' in window)) {
            console.warn('Speech synthesis not supported');
            return;
        }
        
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ar-SA';
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        
        utterance.onstart = () => {
            console.log('🔊 Speaking:', text);
            if (this.onVoiceConfirmation) {
                this.onVoiceConfirmation('start', text);
            }
        };
        
        utterance.onend = () => {
            if (this.onVoiceConfirmation) {
                this.onVoiceConfirmation('end');
            }
        };
        
        window.speechSynthesis.speak(utterance);
    }
    
    /**
     * Load drug database for Fuse.js
     */
    async loadDrugDatabase() {
        try {
            // Try multiple sources
            if (window.allDrugs && window.allDrugs.length > 0) {
                this.drugDatabase = window.allDrugs;
            } else if (window.globalDrugDatabase) {
                this.drugDatabase = window.globalDrugDatabase.getAllDrugs();
            } else {
                const saved = localStorage.getItem('master_drugs');
                if (saved) {
                    this.drugDatabase = JSON.parse(saved);
                }
            }
            
            if (this.drugDatabase.length > 0 && window.Fuse) {
                this.fuse = new Fuse(this.drugDatabase, this.fuseOptions);
                console.log(`✅ Fuse.js ready with ${this.drugDatabase.length} drugs`);
            }
        } catch (error) {
            console.error('❌ Failed to load drug database:', error);
        }
    }
}

// Global instance
window.googleAssistant = new GoogleAssistantVoiceSystem();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoogleAssistantVoiceSystem;
}
