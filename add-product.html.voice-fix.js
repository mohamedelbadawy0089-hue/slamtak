// ============================================
// UNIFIED VOICE SYSTEM - DOMContentLoaded
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    'use strict';
    
    console.log('🎤 DOM Ready - Initializing Voice Systems...');
    
    // 1. REQUEST MICROPHONE PERMISSION IMMEDIATELY
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            console.log('✅ Microphone permission granted');
            stream.getTracks().forEach(track => track.stop()); // Stop immediately, just needed permission
        })
        .catch(err => console.warn('🎤 Microphone permission:', err.message));
    
    // 2. LOAD FUSE.JS FROM CDN
    function loadFuse() {
        return new Promise((resolve, reject) => {
            if (window.Fuse) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js';
            script.onload = () => {
                console.log('⚡ Fuse.js loaded from CDN');
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load Fuse.js'));
            document.head.appendChild(script);
        });
    }
    
    // 3. PRODUCT NAME VOICE ASSISTANT (English with Fuse.js)
    class ProductVoiceAssistant {
        constructor() {
            this.recognition = null;
            this.isListening = false;
            this.fuse = null;
            this.drugs = [];
            this.micBtn = document.getElementById('productMic');
            this.productField = document.getElementById('productName');
            
            if (!this.micBtn || !this.productField) {
                console.error('❌ Product mic button or field not found');
                return;
            }
            
            this.init();
        }
        
        async init() {
            this.setupSpeech();
            await loadFuse();
            this.loadDrugs();
            
            this.micBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggle();
            });
            
            console.log('⚡ Product Voice Ready (English)');
        }
        
        setupSpeech() {
            if (this.recognition) return;
            
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                console.error('Speech Recognition not supported');
                return;
            }
            
            this.recognition = new SR();
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';
            
            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateUI('listening');
            };
            
            this.recognition.onresult = (e) => {
                const last = e.results[e.results.length - 1];
                if (last.isFinal) {
                    this.processFinal(last[0].transcript);
                } else {
                    this.showInterim(last[0].transcript);
                }
            };
            
            this.recognition.onerror = (e) => {
                console.error('Speech error:', e.error);
                this.isListening = false;
                this.updateUI('error');
            };
            
            this.recognition.onend = () => {
                this.isListening = false;
                this.updateUI('idle');
            };
        }
        
        showInterim(text) {
            this.productField.placeholder = '🔊 ' + text;
        }
        
        processFinal(text) {
            const capitalized = text.replace(/\b\w/g, c => c.toUpperCase());
            
            // Try fuzzy match if Fuse is available
            if (this.fuse) {
                const results = this.fuse.search(capitalized);
                if (results.length && results[0].score < 0.3) {
                    const match = results[0].item;
                    const name = match.tradeName || match.name;
                    this.fillField(name);
                    this.speak('تم: ' + name);
                    this.updateUI('success');
                    return;
                }
            }
            
            this.fillField(capitalized);
            this.speak('تم: ' + capitalized);
            this.updateUI('success');
        }
        
        fillField(value) {
            this.productField.value = value;
            this.productField.dispatchEvent(new Event('input', { bubbles: true }));
            this.productField.style.background = '#d4edda';
            setTimeout(() => this.productField.style.background = '', 500);
        }
        
        speak(text) {
            if (!('speechSynthesis' in window)) return;
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'ar-SA';
            u.rate = 1.3;
            window.speechSynthesis.speak(u);
        }
        
        updateUI(state) {
            this.micBtn.classList.remove('listening', 'processing', 'success', 'error');
            const colors = { 
                listening: '#2ecc71', 
                processing: '#3498db', 
                success: '#00ff00', 
                error: '#e74c3c', 
                idle: '#00ff00' 
            };
            this.micBtn.style.background = colors[state] || colors.idle;
            
            if (state === 'listening') this.micBtn.classList.add('listening');
            if (state === 'processing') this.micBtn.classList.add('processing');
            if (state === 'success') this.micBtn.classList.add('success');
            if (state === 'error') this.micBtn.classList.add('error');
            
            const icon = this.micBtn.querySelector('i');
            if (icon) {
                if (state === 'listening') icon.className = 'fas fa-stop';
                else if (state === 'processing') icon.className = 'fas fa-spinner fa-spin';
                else icon.className = 'fas fa-microphone';
            }
        }
        
        loadDrugs() {
            const saved = localStorage.getItem('master_drugs');
            if (saved && window.Fuse) {
                this.drugs = JSON.parse(saved);
                this.fuse = new Fuse(this.drugs, {
                    includeScore: true,
                    threshold: 0.3,
                    keys: ['tradeName', 'name', 'genericName']
                });
                console.log(`💊 ${this.drugs.length} drugs loaded for fuzzy matching`);
            }
        }
        
        start() {
            if (!this.recognition) {
                alert('المتصفح لا يدعم التعرف الصوتي');
                return;
            }
            if (!this.isListening) {
                try { 
                    this.recognition.start(); 
                } catch (e) {
                    console.error('Failed to start:', e);
                }
            }
        }
        
        stop() {
            if (this.recognition && this.isListening) {
                try { this.recognition.stop(); } catch (e) {}
            }
        }
        
        toggle() {
            this.isListening ? this.stop() : this.start();
        }
    }
    
    // 4. ARABIC VOICE ASSISTANT FOR ALL OTHER FIELDS
    class ArabicVoiceAssistant {
        constructor() {
            this.recognition = null;
            this.isListening = false;
            this.currentField = null;
            this.currentBtn = null;
            this.init();
        }
        
        init() {
            // Setup all mic buttons except productMic
            const buttons = document.querySelectorAll('.field-mic-btn:not(#productMic)');
            console.log(`🎤 Found ${buttons.length} Arabic mic buttons`);
            
            buttons.forEach(btn => {
                const fieldId = btn.getAttribute('data-field');
                if (!fieldId) return;
                
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleButtonClick(btn, fieldId);
                });
            });
            
            this.setupSpeech();
            console.log('⚡ Arabic Voice Ready for fields: quantity, discount, price, dates');
        }
        
        setupSpeech() {
            if (this.recognition) return;
            
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                console.error('Speech Recognition not supported');
                return;
            }
            
            this.recognition = new SR();
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            this.recognition.lang = 'ar-SA';
            
            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateUI('listening');
            };
            
            this.recognition.onresult = (e) => {
                const last = e.results[e.results.length - 1];
                const transcript = last[0].transcript;
                
                if (last.isFinal) {
                    this.processFinal(transcript);
                } else {
                    this.showInterim(transcript);
                }
            };
            
            this.recognition.onerror = (e) => {
                console.error('Speech error:', e.error);
                this.isListening = false;
                this.updateUI('error');
            };
            
            this.recognition.onend = () => {
                this.isListening = false;
                this.updateUI('idle');
            };
        }
        
        handleButtonClick(btn, fieldId) {
            // Debounce
            if (this.lastClickTime && Date.now() - this.lastClickTime < 500) return;
            this.lastClickTime = Date.now();
            
            // If already listening to this field, stop
            if (this.isListening && this.currentField === fieldId) {
                this.stop();
                return;
            }
            
            // If listening to different field, stop first
            if (this.isListening) {
                this.stop();
            }
            
            this.currentField = fieldId;
            this.currentBtn = btn;
            this.start();
        }
        
        showInterim(text) {
            const field = document.getElementById(this.currentField);
            if (field) field.placeholder = '🔊 ' + text;
        }
        
        processFinal(text) {
            this.updateUI('processing');
            
            const number = this.extractNumber(text);
            
            if (number !== null) {
                this.fillField(number);
                this.speak('تم: ' + number);
                this.updateUI('success');
            } else {
                this.updateUI('error');
                setTimeout(() => this.updateUI('idle'), 2000);
            }
        }
        
        extractNumber(text) {
            // Arabic to English digit mapping
            const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
            const englishDigits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
            
            let converted = text;
            for (let i = 0; i < 10; i++) {
                converted = converted.replace(new RegExp(arabicDigits[i], 'g'), englishDigits[i]);
            }
            
            // Arabic number words
            const arabicWords = {
                'صفر': 0, 'واحد': 1, 'واحدة': 1, 'اثنين': 2, 'ثلاثة': 3, 'ثلاث': 3,
                'اربعة': 4, 'اربع': 4, 'خمسة': 5, 'خمس': 5, 'ستة': 6, 'ست': 6,
                'سبعة': 7, 'سبع': 7, 'ثمانية': 8, 'ثمان': 8, 'تسعة': 9, 'تسع': 9,
                'عشرة': 10, 'عشر': 10, 'عشرين': 20, 'ثلاثين': 30, 'اربعين': 40,
                'خمسين': 50, 'ستين': 60, 'سبعين': 70, 'ثمانين': 80, 'تسعين': 90,
                'مئة': 100, 'مية': 100, 'الف': 1000, 'ألف': 1000
            };
            
            for (const [word, value] of Object.entries(arabicWords)) {
                if (converted.includes(word)) return value;
            }
            
            // Extract digits
            const digits = converted.replace(/\D/g, '');
            if (digits.length > 0) return parseInt(digits, 10);
            
            return null;
        }
        
        fillField(value) {
            const field = document.getElementById(this.currentField);
            if (!field) return;
            
            field.value = value;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.style.background = '#d4edda';
            setTimeout(() => field.style.background = '', 500);
            
            // Auto-focus next field for dates
            if (this.currentField.includes('Day')) {
                const nextField = document.getElementById(this.currentField.replace('Day', 'Month'));
                if (nextField) setTimeout(() => nextField.focus(), 300);
            } else if (this.currentField.includes('Month')) {
                const nextField = document.getElementById(this.currentField.replace('Month', 'Year'));
                if (nextField) setTimeout(() => nextField.focus(), 300);
            }
        }
        
        speak(text) {
            if (!('speechSynthesis' in window)) return;
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'ar-SA';
            u.rate = 1.2;
            window.speechSynthesis.speak(u);
        }
        
        updateUI(state) {
            if (!this.currentBtn) return;
            
            this.currentBtn.classList.remove('listening', 'processing', 'success', 'error');
            const colors = { 
                listening: '#2ecc71', 
                processing: '#3498db', 
                success: '#00ff00', 
                error: '#e74c3c', 
                idle: '' 
            };
            this.currentBtn.style.background = colors[state] || '';
            
            if (state === 'listening') this.currentBtn.classList.add('listening');
            if (state === 'processing') this.currentBtn.classList.add('processing');
            if (state === 'success') this.currentBtn.classList.add('success');
            if (state === 'error') this.currentBtn.classList.add('error');
            
            const icon = this.currentBtn.querySelector('i');
            if (icon) {
                if (state === 'listening') icon.className = 'fas fa-stop';
                else if (state === 'processing') icon.className = 'fas fa-spinner fa-spin';
                else icon.className = 'fas fa-microphone';
            }
        }
        
        start() {
            if (!this.recognition) {
                alert('المتصفح لا يدعم التعرف الصوتي');
                return;
            }
            if (!this.isListening) {
                try { this.recognition.start(); } 
                catch (e) { console.error('Start error:', e); }
            }
        }
        
        stop() {
            if (this.recognition && this.isListening) {
                try { this.recognition.stop(); } catch (e) {}
            }
        }
    }
    
    // 5. INITIALIZE BOTH SYSTEMS
    const productAssistant = new ProductVoiceAssistant();
    const arabicAssistant = new ArabicVoiceAssistant();
    
    console.log('✅ All Voice Systems Initialized');
});
</script>

</body>
</html>
