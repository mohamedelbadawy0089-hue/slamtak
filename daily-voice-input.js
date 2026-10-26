// ============================================
// Daily Voice Input System
// Continuous Product Addition | Hardware Speed
// ============================================

class DailyVoiceInputSystem {
    constructor() {
        this.sessionProducts = [];
        this.isSessionActive = false;
        this.audioProcessor = null;
        this.drugMatcher = null;
        this.recognition = null;
        this.sessionStats = {
            totalAdded: 0,
            totalValue: 0,
            startTime: null,
            endTime: null
        };
        
        // Batch processing queue
        this.pendingQueue = [];
        this.batchSize = 5;
        this.autoSaveInterval = null;
    }
    
    // Initialize daily session
    async initializeSession() {
        this.isSessionActive = true;
        this.sessionStats.startTime = new Date();
        this.sessionProducts = [];
        
        // Initialize audio processor
        this.audioProcessor = new SovereignAudioProcessor();
        await this.audioProcessor.initialize();
        
        // Initialize drug matcher
        this.drugMatcher = new StrictDrugMatcher();
        
        // Start auto-save
        this.startAutoSave();
        
        console.log('📅 Daily Voice Session started');
        this.logToUI('📅 بدأت جلسة الإدخال الصوتي اليومية');
        
        return true;
    }
    
    // Start continuous listening
    async startContinuousListening() {
        if (!this.isSessionActive) {
            await this.initializeSession();
        }
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.logToUI('❌ المتصفح لا يدعم التعرف الصوتي', 'error');
            return false;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        
        // Process results
        this.recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript;
                
                if (result.isFinal) {
                    this.processVoiceCommand(transcript);
                } else {
                    // Show interim results
                    this.showInterimResult(transcript);
                }
            }
        };
        
        this.recognition.onerror = (event) => {
            if (event.error !== 'no-speech') {
                console.error('Recognition error:', event.error);
                this.logToUI(`⚠️ ${event.error} - جاري إعادة المحاولة...`, 'warn');
                
                // Auto-restart on error (except no-speech)
                setTimeout(() => {
                    if (this.isSessionActive) {
                        this.recognition.start();
                    }
                }, 1000);
            }
        };
        
        this.recognition.onend = () => {
            if (this.isSessionActive) {
                // Restart if session still active
                this.recognition.start();
            }
        };
        
        this.recognition.start();
        this.logToUI('🎤 الاستماع المستمر نشط - انطق اسم الدواء والكمية');
        
        return true;
    }
    
    // Process voice command
    processVoiceCommand(transcript) {
        console.log('Processing:', transcript);
        
        // Parse command for drug + quantity
        const parsed = this.parseVoiceCommand(transcript);
        
        if (parsed.drugName) {
            // Match to drug encyclopedia
            const match = this.drugMatcher.forceMatch(parsed.drugName);
            
            if (match.found) {
                const product = {
                    id: Date.now(),
                    name: match.result.drug.tradeNames[0],
                    scientificName: match.result.drug.scientificName,
                    quantity: parsed.quantity || 1,
                    price: match.result.drug.price,
                    company: match.result.drug.company,
                    category: match.result.drug.category,
                    confidence: match.result.confidence,
                    rawInput: transcript,
                    timestamp: new Date().toISOString(),
                    total: match.result.drug.price * (parsed.quantity || 1)
                };
                
                this.addProduct(product);
            } else {
                this.logToUI(`❌ "${parsed.drugName}" غير موجود في الموسوعة`, 'error');
            }
        }
    }
    
    // Parse voice command for drug name and quantity
    parseVoiceCommand(transcript) {
        // Common patterns:
        // "Panadol 5 boxes"
        // "Add 10 Augmentin"
        // "Brufen three packs"
        // "Cataflam number 2"
        
        let drugName = null;
        let quantity = 1;
        
        // Extract quantity - look for numbers (Arabic or English)
        const numberMatches = transcript.match(/(\d+)|(\b(one|two|three|four|five|six|seven|eight|nine|ten)\b)/gi);
        if (numberMatches) {
            const num = numberMatches[0].toLowerCase();
            const wordNumbers = {
                'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
                'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
            };
            quantity = parseInt(num) || wordNumbers[num] || 1;
        }
        
        // Extract drug name by matching against encyclopedia
        const words = transcript.toLowerCase().split(/\s+/);
        
        for (const word of words) {
            // Skip quantity words and common words
            if (/^\d+$/.test(word)) continue;
            if (['add', 'box', 'boxes', 'pack', 'packs', 'number', 'of'].includes(word)) continue;
            
            // Check if word matches any drug
            const match = this.drugMatcher.forceMatch(word);
            if (match.found) {
                drugName = word;
                break;
            }
        }
        
        return { drugName, quantity };
    }
    
    // Add product to session
    addProduct(product) {
        this.sessionProducts.push(product);
        this.pendingQueue.push(product);
        
        // Update stats
        this.sessionStats.totalAdded++;
        this.sessionStats.totalValue += product.total;
        
        // UI updates
        this.displayProduct(product);
        this.updateSessionStats();
        
        // Success feedback
        this.logToUI(`✅ تمت إضافة: ${product.name} × ${product.quantity} = ${product.total.toFixed(2)} ج.م`, 'success');
        
        // Batch save if queue is full
        if (this.pendingQueue.length >= this.batchSize) {
            this.saveBatch();
        }
        
        // Play success sound (visual feedback)
        this.triggerSuccessFeedback();
    }
    
    // Display product in daily list
    displayProduct(product) {
        const container = document.getElementById('dailyProductsList');
        if (!container) return;
        
        const item = document.createElement('div');
        item.className = 'daily-product-item';
        item.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            margin: 8px 0;
            background: rgba(0, 217, 255, 0.1);
            border-right: 3px solid #00d9ff;
            border-radius: 8px;
            animation: slideIn 0.3s ease;
        `;
        
        item.innerHTML = `
            <div>
                <div style="font-weight: bold; color: #fff;">${product.name}</div>
                <div style="font-size: 0.85rem; color: #a0a0a0;">
                    ${product.scientificName} | ${product.company}
                </div>
                <div style="font-size: 0.8rem; color: #00d9ff; margin-top: 4px;">
                    <i class="fas fa-microphone"></i> "${product.rawInput}"
                </div>
            </div>
            <div style="text-align: left;">
                <div style="font-size: 1.2rem; font-weight: bold; color: #f39c12;">
                    × ${product.quantity}
                </div>
                <div style="color: #00d9ff; font-weight: bold;">
                    ${product.total.toFixed(2)} ج.م
                </div>
            </div>
        `;
        
        container.insertBefore(item, container.firstChild);
    }
    
    // Update session statistics display
    updateSessionStats() {
        const statsEl = document.getElementById('sessionStats');
        if (!statsEl) return;
        
        const duration = this.sessionStats.startTime ? 
            Math.floor((Date.now() - this.sessionStats.startTime) / 1000) : 0;
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        
        statsEl.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; text-align: center;">
                <div style="background: rgba(233, 69, 96, 0.2); padding: 15px; border-radius: 10px;">
                    <div style="font-size: 1.5rem; font-weight: bold; color: #e94560;">
                        ${this.sessionStats.totalAdded}
                    </div>
                    <div style="font-size: 0.9rem; color: #a0a0a0;">منتجات</div>
                </div>
                <div style="background: rgba(0, 217, 255, 0.2); padding: 15px; border-radius: 10px;">
                    <div style="font-size: 1.5rem; font-weight: bold; color: #00d9ff;">
                        ${this.sessionStats.totalValue.toFixed(2)}
                    </div>
                    <div style="font-size: 0.9rem; color: #a0a0a0;">إجمالي (ج.م)</div>
                </div>
                <div style="background: rgba(243, 156, 18, 0.2); padding: 15px; border-radius: 10px;">
                    <div style="font-size: 1.5rem; font-weight: bold; color: #f39c12;">
                        ${minutes}:${seconds.toString().padStart(2, '0')}
                    </div>
                    <div style="font-size: 0.9rem; color: #a0a0a0;">مدة الجلسة</div>
                </div>
            </div>
        `;
    }
    
    // Auto-save batch to local storage
    saveBatch() {
        if (this.pendingQueue.length === 0) return;
        
        const inventory = JSON.parse(localStorage.getItem('sovereign_daily_inventory') || '[]');
        inventory.push(...this.pendingQueue);
        localStorage.setItem('sovereign_daily_inventory', JSON.stringify(inventory));
        
        this.logToUI(`💾 تم حفظ ${this.pendingQueue.length} منتجات تلقائياً`, 'info');
        this.pendingQueue = [];
    }
    
    // Start auto-save interval
    startAutoSave() {
        this.autoSaveInterval = setInterval(() => {
            if (this.pendingQueue.length > 0) {
                this.saveBatch();
            }
        }, 30000); // Auto-save every 30 seconds
    }
    
    // Stop auto-save
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    }
    
    // End session and finalize
    async endSession() {
        this.isSessionActive = false;
        this.sessionStats.endTime = new Date();
        
        // Stop recognition
        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
        }
        
        // Stop auto-save
        this.stopAutoSave();
        
        // Save remaining queue
        this.saveBatch();
        
        // Generate session report
        const report = this.generateSessionReport();
        
        this.logToUI(`🏁 انتهت الجلسة - ${this.sessionStats.totalAdded} منتجات - ${this.sessionStats.totalValue.toFixed(2)} ج.م`, 'success');
        
        return report;
    }
    
    // Generate session report
    generateSessionReport() {
        const duration = (this.sessionStats.endTime - this.sessionStats.startTime) / 1000;
        
        // Group by category
        const byCategory = {};
        this.sessionProducts.forEach(p => {
            byCategory[p.category] = (byCategory[p.category] || 0) + 1;
        });
        
        return {
            date: new Date().toISOString().split('T')[0],
            startTime: this.sessionStats.startTime.toISOString(),
            endTime: this.sessionStats.endTime.toISOString(),
            duration: Math.round(duration),
            totalProducts: this.sessionStats.totalAdded,
            totalValue: this.sessionStats.totalValue,
            byCategory,
            products: this.sessionProducts
        };
    }
    
    // UI helper: Show interim result
    showInterimResult(transcript) {
        const el = document.getElementById('interimResult');
        if (el) {
            el.textContent = transcript;
            el.style.opacity = '0.7';
        }
    }
    
    // UI helper: Log to console and UI
    logToUI(message, type = 'info') {
        console.log(`[DailyVoice] ${message}`);
        
        const consoleEl = document.getElementById('dailyConsole');
        if (consoleEl) {
            const line = document.createElement('div');
            line.className = `console-line ${type}`;
            line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            consoleEl.appendChild(line);
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    }
    
    // Visual feedback for success
    triggerSuccessFeedback() {
        // Flash effect
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 217, 255, 0.2);
            pointer-events: none;
            z-index: 9999;
            animation: flash 0.3s ease;
        `;
        document.body.appendChild(flash);
        
        setTimeout(() => flash.remove(), 300);
    }
    
    // Quick commands
    executeQuickCommand(command) {
        switch(command) {
            case 'save':
                this.saveBatch();
                this.logToUI('💾 تم الحفظ اليدوي', 'success');
                break;
            case 'clear':
                this.pendingQueue = [];
                this.logToUI('🗑️ تم مسح قائمة الانتظار', 'info');
                break;
            case 'stats':
                this.updateSessionStats();
                break;
            case 'help':
                this.showHelp();
                break;
        }
    }
    
    showHelp() {
        const help = `
        أوامر صوتية:
        • "Panadol 5" - إضافة 5 علب بانادول
        • "Augmentin 10" - إضافة 10 علب أوجمنتين
        • "حفظ" - حفظ الدفعة الحالية
        • "إحصائيات" - عرض إحصائيات الجلسة
        • "إنهاء" - إنهاء الجلسة وحفظ كل شيء
        `;
        this.logToUI(help, 'info');
    }
}

// ============================================
// Export for module use
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DailyVoiceInputSystem };
}

window.DailyVoiceInputSystem = DailyVoiceInputSystem;

console.log('📅 Daily Voice Input System loaded');
