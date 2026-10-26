// Web Speech API - Voice Input System (Arabic Egyptian) v10.1
// Advanced Arabic Number Converter Library

// Auth Guard System - يتحقق من auth-guard.js
if (typeof window.authGuard === 'undefined') {
    console.error('❌ Auth Guard غير مهيأ، جاري التحميل...');
    // تحميل auth-guard.js إذا لم يتم تحميله
    const script = document.createElement('script');
    script.src = 'auth-guard.js';
    script.onload = () => {
        console.log('✅ تم تحميل Auth Guard بنجاح');
    };
    document.head.appendChild(script);
}

// مكتبة تحويل الأرقام العربية المتقدمة v10.1


class ArabicNumberConverter {
    constructor() {
        this.initializeDictionaries();
        this.setupAdvancedRegex();
        this.loadProductsFromDatabase();
    }
    
    async loadProductsFromDatabase() {
        const supabase = window.supabaseClient || window.supabase;
        if (!supabase) return;
        try {
            const { data, error } = await supabase.from('products').select('name');
            if (error) throw error;
            if (data && data.length > 0) {
                data.forEach(product => {
                    if (product.name) {
                        const originalName = product.name.trim();
                        const sanitized = originalName.toLowerCase();
                        if (sanitized && !this.productDatabase[sanitized]) {
                            this.productDatabase[sanitized] = originalName;
                        }
                    }
                });
            }
        } catch (e) { console.error('Error loading products:', e); }
    }

    initializeDictionaries() {
        this.basicNumbers = {
            'صفر': 0, 'واحد': 1, 'اثنان': 2, 'اتنين': 2, 'ثلاث': 3, 'تلات': 3, 'تلاثة': 3, 'أربعة': 4, 'اربعة': 4, 'خمسة': 5,
            'ستة': 6, 'سبعة': 7, 'ثمانية': 8, 'تمنية': 8, 'تمانية': 8, 'تمن': 8, 'أمن': 8, 'امن': 8, 'تمان': 8, 'تسعة': 9, 'عشرة': 10,
            'أحد عشر': 11, 'حدي عشر': 11, 'إحدى عشر': 11, 'احدي عشر': 11, 'حداشر': 11,
            'اثنا عشر': 12, 'اتني عشر': 12, 'إثنا عشر': 12, 'اثني عشر': 12, 'إثني عشر': 12, 'اتناشر': 12,
            'ثلاثة عشر': 13, 'تلتاشر': 13, 'تلاتاشر': 13,
            'أربعة عشر': 14, 'اربعتاشر': 14, 'اريعتاشر': 14, 'اربعطاشر': 14, 'اربعه عشر': 14, 
            'خمسة عشر': 15, 'خمسطاشر': 15, 'خمستاشر': 15, 'خمطاشر': 15,
            'ستة عشر': 16, 'ستاشر': 16, 'سبعة عشر': 17, 'سبعتاشر': 17, 'سبعطاشر': 17,
            'ثمانية عشر': 18, 'تمنتاشر': 18, 'تمنطاشر': 18, 'تمانية عشر': 18,
            'تسعة عشر': 19, 'تسعتاشر': 19, 'تسعطاشر': 19,
            'عشرون': 20, 'عشرين': 20, 'ثلاثون': 30, 'تلاتين': 30, 'أربعون': 40, 'اربعين': 40,
            'خمسون': 50, 'خمسين': 50, 'ستون': 60, 'ستين': 60, 'سبعون': 70, 'سبعين': 70,
            'ثمانون': 80, 'تمانين': 80, 'تسعون': 90, 'تسعين': 90,
            'مئة': 100, 'مائة': 100, 'مية': 100, 'ميه': 100,
            'مائتان': 200, 'ميتين': 200, 'ثلاثمائة': 300, 'تلاتميه': 300,
            'أربعمائة': 400, 'اربعميه': 400, 'خمسمائة': 500, 'خمسميه': 500,
            'ستمائة': 600, 'ستوميه': 600, 'سبعمائة': 700, 'سبعميه': 700,
            'ثمانمائة': 800, 'تمونميه': 800, 'تسعمائة': 900, 'تسعميه': 900,
            'ألف': 1000, 'الف': 1000, 'ألفين': 2000, 'الفين': 2000,
            'تلتلاف': 3000, 'تلاته تلاف': 3000, 'تلاتة تلاف': 3000,
            'اربعتلاف': 4000, 'اربعة تلاف': 4000,
            'خمستلاف': 5000, 'خمسة تلاف': 5000,
            'ستلاف': 6000, 'ستة تلاف': 6000,
            'سبعتلاف': 7000, 'سبعة تلاف': 7000,
            'تمنتلاف': 8000, 'تمانية تلاف': 8000,
            'تسعتلاف': 9000, 'تسعة تلاف': 9000,
            'عشرتلاف': 10000, 'عشرة تلاف': 10000,
            'مليون': 1000000, 'ملايين': 1000000, 'مليار': 1000000000
        };
        
        this.complexNumbers = {
            'مية وواحد': 101, 'ميه وواحد': 101, 'مية واتنين': 102, 'ميه واتنين': 102,
            'مية وتلات': 103, 'ميه وتلات': 103, 'مية واربعة': 104, 'ميه واربعة': 104,
            'مية وخمسة': 105, 'ميه وخمسة': 105, 'مية وستة': 106, 'ميه وستة': 106,
            'مية وسبعة': 107, 'ميه وسبعة': 107, 'مية وتمن': 108, 'ميه وتمن': 108,
            'مية وتسعة': 109, 'ميه وتسعة': 109, 'مية وعشرة': 110, 'ميه وعشرة': 110,
            'مية وحداشر': 111, 'ميه وحداشر': 111, 'مية واتناشر': 112, 'ميه واتناشر': 112,
            'مية وتلاتاشر': 113, 'ميه وتلاتاشر': 113, 'مية واربعتاشر': 114, 'ميه واربعتاشر': 114,
            'مية وخمستاشر': 115, 'ميه وخمستاشر': 115, 'مية وستاشر': 116, 'ميه وستاشر': 116,
            'مية وسبعتاشر': 117, 'ميه وسبعتاشر': 117, 'مية وتمنتاشر': 118, 'ميه وتمنتاشر': 118,
            'مية وتسعتاشر': 119, 'ميه وتسعتاشر': 119, 'مية وعشرين': 120, 'ميه وعشرين': 120,
            'ميتين وواحد': 201, 'ميتين وعشرة': 210, 'تلاتميه وعشرة': 310, 'اربعميه وعشرة': 410,
            'الفين وعشرة': 2010, 'الفين وحداشر': 2011, 'الفين واتناشر': 2012, 'الفين وتلاتاشر': 2013,
            'الفين واربعتاشر': 2014, 'الفين وخمستاشر': 2015, 'الفين وستاشر': 2016, 'الفين وسبعتاشر': 2017,
            'الفين وتمنتاشر': 2018, 'الفين وتسعتاشر': 2019, 'الفين وعشرين': 2020
        };
        
        this.productDatabase = {
            'بانادول': 'بانادول', 'باراسيتامول': 'باراسيتامول', 'أدول': 'أدول', 'بيرال': 'بيرال',
            'بروفين': 'بروفين', 'إيبوبروفين': 'إيبوبروفين', 'كتوفان': 'كتوفان', 'كيتوبروفين': 'كيتوبروفين',
            'باي الكوفان': 'باي الكوفان', 'باي بروفينيد': 'باي بروفينيد', 'فولتارين': 'فولتارين',
            'ديكلوفيناك': 'ديكلوفيناك', 'ديكلاك': 'ديكلاك', 'أنتيفلام': 'أنتيفلام', 'كاتافلام': 'كاتافلام',
            'أوجمنتين': 'أوجمنتين', 'هاي بيوتك': 'هاي بيوتك', 'كيرام': 'كيرام', 'أموكيسيلين': 'أموكيسيلين',
            'كونكور': 'كونكور', 'بيسوبرولول': 'بيسوبرولول', 'إكسفورج': 'إكسفورج', 'أملوديبين': 'أملوديبين',
            'أوميقا 3': 'أوميقا 3', 'سنترم': 'سنترم', 'فيتاماكس': 'فيتاماكس', 'كيروفيت': 'كيروفيت',
            'كلاريتين': 'كلاريتين', 'زيرتك': 'زيرتك', 'سيتريزين': 'سيتريزين', 'تلفاست': 'تلفاست'
        };

        this.productKeywords = [
            'بانادول', 'أسبيرين', 'أدفل', 'بروفين', 'فولتارين', 'باراسيتامول',
            'أوجمنتين', 'زيروماكس', 'كونكور', 'فيتامين', 'حديد', 'كلسيوم',
            'كريم', 'مرهم', 'غسول', 'صابون', 'شامبو', 'مطهر', 'قطرة'
        ];
    }

    setupAdvancedRegex() {
        this.numberPattern = new RegExp(
            Object.keys(this.complexNumbers)
                .concat(Object.keys(this.basicNumbers))
                .sort((a, b) => b.length - a.length)
                .join('|'),
            'gi'
        );

        this.decimalPattern = /(\d+)\s*(?:فاصلة|بوينت|\.||،|نقطة)\s*(\d+)|(\d+)\s*(?:[\sو]+)\s*(\d{1,2})\s*(?:من\s+)?(?:مئة|ميه|مية|مئات|100|قرش|صاغ)\b/gi;
    }

    convertRealTime(text, callback) {
        console.log('🔄 Real-time conversion started:', text);
        let convertedText = text;
        
        // معالجة الكسور العشرية بالعامية المصرية (قبل تحويل الأرقام)
        // النمط: "مية وسبعتاشر وتسعتاشر من مية" → 117.19
        const egyptianFractionPattern = /(\S+?)\s*و\s*(\S+?)\s*و\s*(\S+?)\s*من\s*(?:مئة|ميه|مية|100)\b/gi;
        convertedText = convertedText.replace(egyptianFractionPattern, (m, p1, p2, p3) => {
            const n1 = this.convertSingleNumber(p1) || 0;
            const n2 = this.convertSingleNumber(p2) || 0;
            const n3 = this.convertSingleNumber(p3) || 0;
            const whole = n1 + n2;
            const fraction = n3 / 100;
            return (whole + fraction).toFixed(2);
        });
        
        // نمط مبسط: "مئة وسبعتاشر من مية" → 100.17
        const simpleFractionPattern = /(\S+?)\s*و\s*(\S+?)\s*من\s*(?:مئة|ميه|مية|100)\b/gi;
        convertedText = convertedText.replace(simpleFractionPattern, (m, p1, p2) => {
            const n1 = this.convertSingleNumber(p1) || 0;
            const n2 = this.convertSingleNumber(p2) || 0;
            const fraction = n2 / 100;
            return (n1 + fraction).toFixed(2);
        });
        
        const matches = text.match(this.numberPattern);
        if (matches) {
            matches.forEach(match => {
                const number = this.convertSingleNumber(match);
                if (number !== null) {
                    convertedText = convertedText.replace(new RegExp('(^|\\s|و)' + match + '(\\s|$|،)', 'gi'), `$1${number}$2`);
                    if (callback) callback(match, number);
                }
            });
        }

        // --- نظام دمج الأرقام المتقدم (Multi-Pass) ---
        // المرحلة 1: دمج الآحاد والعشرات (مثل 5 و 20 -> 21)
        convertedText = convertedText.replace(/\b([1-9])\s*[\sو]+\s*([2-9]0)\b/g, (m, p1, p2) => (parseInt(p1) + parseInt(p2)).toString());
        
        // المرحلة 2: دمج المئات مع ما بعدها (مثل 100 و 21 -> 121)
        for(let i=0; i<2; i++) {
            convertedText = convertedText.replace(/\b(\d+00)\s*[\sو]+\s*(\d{1,2})\b(?![\s]*(?:من|على|بالمية|%))/g, (m, p1, p2) => (parseInt(p1) + parseInt(p2)).toString());
        }

        // المرحلة 3: دمج الآلاف مع ما بعدها (مثل 1000 و 121 -> 1121)
        for(let i=0; i<2; i++) {
            convertedText = convertedText.replace(/\b(\d+000)\s*[\sو]+\s*(\d{1,3})\b(?![\s]*(?:من|على|بالمية|%))/g, (m, p1, p2) => (parseInt(p1) + parseInt(p2)).toString());
        }
        
        // المرحلة 4: دمج الملايين
        convertedText = convertedText.replace(/\b(\d+000000)\s*[\sو]+\s*(\d{1,6})\b(?![\s]*(?:من|على|بالمية|%))/g, (m, p1, p2) => (parseInt(p1) + parseInt(p2)).toString());

        // معالجة الكسور الشاملة: "رقم وقرش" أو "رقم من مية" أو "رقم بالمية"
        convertedText = convertedText.replace(/(\d+)(?:\s*(?:جنيه|ج|ريال|درهم|دولار))?[\sو]+(\d{1,2})\s*(?:من\s+|على\s+|بالمية|%)?(?:مئة|ميه|مية|مئات|100|قرش|صاغ)\b/gi, (m, p1, p2) => `${p1}.${p2.padStart(2, '0')}`);
        
        // الكسور المعزولة (مثل "خمسة من مية")
        convertedText = convertedText.replace(/(?:^|\s|،)(?:و\s+)?(\d{1,2})\s*(?:من\s+|على\s+|بالمية|%)(?:مئة|ميه|مية|100|قرش|صاغ)\b/gi, (m, p1) => ` 0.${p1.padStart(2, '0')}`);
        
        // معالجة الكسور العشرية بالعامية المصرية: "مية وسبعتاشر وتسعتاشر من مية" → 117.19
        // النمط: رقم (صحيح) + و + رقم (كسر) + من مية
        convertedText = convertedText.replace(/(\d+)\s*و\s*(\d+)\s*و\s*(\d+)\s*من\s*(?:مئة|ميه|مية|100)\b/gi, (m, p1, p2, p3) => {
            const whole = parseInt(p1) + parseInt(p2);
            const fraction = parseInt(p3) / 100;
            return (whole + fraction).toFixed(2);
        });
        
        // نمط مبسط: "مئة وسبعتاشر وتسعتاشر من مية" (مع تحويل الكلمات أولاً)
        convertedText = convertedText.replace(/(\d+)\s*و\s*(\d+)\s*من\s*(?:مئة|ميه|مية|100)\b/gi, (m, p1, p2) => {
            const whole = parseInt(p1);
            const fraction = parseInt(p2) / 100;
            return (whole + fraction).toFixed(2);
        });
        
        // دعم صيغة "فاصلة/نقطة" للأرقام الكبيرة
        convertedText = convertedText.replace(/(\d+)\s*(?:فاصلة|بوينت|علامة عشرية|نقطة)\s*(\d+)/gi, (m, p1, p2) => `${p1}.${p2}`);
        
        // الكسور الشهيرة
        convertedText = convertedText.replace(/(\d+)\s+[\sو]+\s*(نصف|نص)\b/gi, '$1.5');
        convertedText = convertedText.replace(/(\d+)\s+[\sو]+\s*(ربع)\b/gi, '$1.25');
        convertedText = convertedText.replace(/(\d+)\s+[\sو]+\s*(تلات ارباع|تلات تربع)\b/gi, '$1.75');
        convertedText = convertedText.replace(/\bجنيه\s+[\sو]+\s*(نصف|نص)\b/gi, '1.5');
        convertedText = convertedText.replace(/\bجنيه\s+[\sو]+\s*(ربع)\b/gi, '1.25');

        console.log('✅ Real-time conversion result:', convertedText);
        return convertedText;
    }

    convertSingleNumber(arabicNumber) {
        if (this.complexNumbers[arabicNumber.toLowerCase()]) return this.complexNumbers[arabicNumber.toLowerCase()];
        if (this.basicNumbers[arabicNumber.toLowerCase()]) return this.basicNumbers[arabicNumber.toLowerCase()];
        return null;
    }

    extractNumbersAndWords(text) {
        const result = { numbers: [], words: [], originalText: text, convertedText: text, detectedProducts: [], decimalInfo: null, context: null };
        result.convertedText = this.convertRealTime(text, (arabic, number) => {
            result.numbers.push({ arabic: arabic, number: number, position: text.indexOf(arabic) });
        });
        result.decimalInfo = this.detectDecimalInfo(result.convertedText);
        result.context = this.detectContext(result.convertedText);
        const products = this.identifyProducts(result.convertedText);
        result.detectedProducts = products;
        const words = result.convertedText.split(/\s+/);
        result.words = words.filter(word => {
            const isNumber = /^\d+(\.\d+)?$/.test(word);
            const isProduct = products.some(p => p.name === word);
            return !isNumber && !isProduct && word.trim().length > 0;
        });
        return result;
    }

    parseYearPhrase(text) {
        const normalized = text.toLowerCase().trim();
        if (!normalized) return null;

        const directNumber = this.convertSingleNumber(normalized);
        if (directNumber !== null) {
            return directNumber;
        }

        const conversion = this.extractNumbersAndWords(normalized);
        if (!conversion.numbers || conversion.numbers.length === 0) {
            return null;
        }

        const yearNumbers = conversion.numbers.map(n => n.number).filter(n => typeof n === 'number');
        if (yearNumbers.length === 0) {
            return null;
        }

        const baseYear = yearNumbers.find(n => n >= 2000 && n <= 2100);
        const smallParts = yearNumbers.filter(n => n > 0 && n < 100);
        if (baseYear !== undefined && smallParts.length > 0) {
            const combined = baseYear + smallParts.reduce((sum, part) => sum + part, 0);
            if (combined >= 2000 && combined <= 2099) {
                return combined;
            }
        }

        const first = yearNumbers[0];
        if (first >= 0 && first <= 30) {
            return 2000 + first;
        }
        if (first >= 2000 && first <= 2099) {
            return first;
        }
        return first;
    }

    detectDecimalInfo(text) {
        this.decimalPattern.lastIndex = 0;
        const match = this.decimalPattern.exec(text);
        if (match) {
            let whole, fraction, value;
            if (match[1] !== undefined) { whole = parseInt(match[1]); fraction = parseInt(match[2]); }
            else { whole = parseInt(match[3]); fraction = parseInt(match[4]); }
            let fractionStr = fraction.toString();
            if (fractionStr.length === 1 && !text.includes('فاصلة') && !text.includes('بوينت') && !text.includes('.')) {
                fractionStr = fractionStr.padStart(2, '0');
            }
            value = parseFloat(`${whole}.${fractionStr}`);
            return { whole, fraction, value, text: match[0] };
        }
        return null;
    }

    detectContext(text) {
        const lowerText = text.toLowerCase();
        return {
            isPriceContext: ['سعر', 'جنيه', 'جنية', 'ريال', 'دولار', 'بجنيه', 'بسعر', 'فلوس', 'ثمن'].some(w => lowerText.includes(w)),
            isQuantityContext: ['كمية', 'عدد', 'قطعة', 'قطع', 'علبة', 'علب', 'كرتونة', 'كراتين', 'صندوق'].some(w => lowerText.includes(w)),
            isDiscountContext: ['خصم', 'تخفيض', 'بخصم', 'نسبة'].some(w => lowerText.includes(w))
        };
    }

    identifyProducts(text) {
        const detectedProducts = [];
        const words = text.split(/\s+/);
        for (const word of words) {
            const cleanWord = word.toLowerCase().trim();
            if (this.productDatabase[cleanWord]) {
                detectedProducts.push({ original: word, name: this.productDatabase[cleanWord], confidence: 'high' });
            } else if (this.isProductKeyword(cleanWord)) {
                detectedProducts.push({ original: word, name: cleanWord, confidence: 'medium' });
            }
        }
        return detectedProducts;
    }

    isProductKeyword(word) { return this.productKeywords.some(keyword => word.includes(keyword) || keyword.includes(word)); }
}
class VoiceInputProcessor {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.autoRepeatEnabled = false;
        this.targetField = null; // الحقل المستهدف عند الضغط على زر ميكروفون محلي
        
        // تهيئة Web Speech API
        this.initializeSpeechRecognition();
        
        // تهيئة مكتبة تحويل الأرقام العربية v10.1
        this.arabicNumberConverter = new ArabicNumberConverter();
        
        // ربط العناصر
        this.bindElements();
        
        // ربط الأحداث
        this.setupEventListeners();
    }
    
    initializeSpeechRecognition() {
        // التحقق من دعم المتصفح
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.warn('❌ متصفحك لا يدعم الإدخال الصوتي');
            if (this.voiceBtn) {
                this.voiceBtn.style.display = 'none';
            }
            // إخفاء جميع أزرار الميكروفون
            if (this.fieldMicBtns) {
                this.fieldMicBtns.forEach(btn => btn.style.display = 'none');
            }
            return;
        }
        
        try {
            // تهيئة الـ Speech Recognition
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            
            // إعدادات محسنة للدقة الأفضل
            this.recognition.lang = 'en-US';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.maxAlternatives = 3;
            
            console.log('✅ تم تهيئة التعرف الصوتي بنجاح');
        } catch (error) {
            console.error('❌ فشل في تهيئة التعرف الصوتي:', error);
            if (this.voiceBtn) {
                this.voiceBtn.style.display = 'none';
            }
            if (this.fieldMicBtns) {
                this.fieldMicBtns.forEach(btn => btn.style.display = 'none');
            }
        }
    }
    
    bindElements() {
        this.voiceBtn = document.getElementById('voiceInputBtn');
        this.productNameInput = document.getElementById('productName');
        this.priceInput = document.getElementById('price');
        this.priceIntInput = document.getElementById('priceInt');
        this.priceFracInput = document.getElementById('priceFrac');
        this.quantityInput = document.getElementById('quantity');
        this.discountInput = document.getElementById('discount');
        this.fieldMicBtns = document.querySelectorAll('.field-mic-btn');
    }
    
    setupEventListeners() {
        if (this.voiceBtn) {
            // زر الإدخال الصوتي العام
            this.voiceBtn.addEventListener('click', () => {
                if (this.isListening) {
                    this.stopListening();
                    this.disableAutoRepeat();
                } else {
                    this.startListening(); // إدخال عام
                }
            });
        }
        
        if (this.fieldMicBtns) {
            // أزرار الحقول الفردية
            this.fieldMicBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const fieldName = e.currentTarget.getAttribute('data-field');
                    if (this.isListening && this.targetField === fieldName) {
                        this.stopListening();
                        this.disableAutoRepeat();
                        this.targetField = null;
                        this.updateButtonState(false);
                    } else {
                        // إيقاف أي استماع حالي ثم بدء استماع جديد مخصص
                        this.stopListening();
                        this.startListening(fieldName);
                    }
                });
            });
        }
        
        // أحداث الـ Speech Recognition محسنة لالتقاط أفضل البيانات
        this.recognition.onstart = () => {
            console.log('🎤 بدأ الاستماع' + (this.targetField ? ` لحقل ${this.targetField}` : ' العام') + '...');
            console.log('🔊 إعدادات الميكروفون:', {
                lang: this.recognition.lang,
                continuous: this.recognition.continuous,
                interimResults: this.recognition.interimResults,
                maxAlternatives: this.recognition.maxAlternatives
            });
            this.updateButtonState(true);
        };
        
        this.recognition.onresult = (event) => {
            console.log('📝 تم الحصول على نتائج التعرف الصوتي:', event.results.length, 'نتيجة');
            console.log('🔊 تفاصيل النتائج:', event.results);
            
            // معالجة جميع البدائل المتاحة للدقة الأفضل
            const results = event.results[0];
            let bestTranscript = results[0].transcript;
            let bestConfidence = results[0].confidence || 0;
            
            // البحث عن أفضل نتيجة بناءً على الثقة والتطابق
            for (let i = 1; i < results.length; i++) {
                const alternative = results[i];
                const confidence = alternative.confidence || 0;
                
                console.log(`🔍 البديل ${i}:`, alternative.transcript, '(ثقة:', (confidence * 100).toFixed(1) + '%)');
                
                // للأسماء الطويلة، نفضل النتيجة الأطول بثقة عالية
                if (this.targetField === 'productName' && 
                    alternative.transcript.length > bestTranscript.length && 
                    confidence > bestConfidence * 0.8) {
                    bestTranscript = alternative.transcript;
                    bestConfidence = confidence;
                }
                // للحقول الأخرى، نفضل النتيجة الأعلى ثقة
                else if (confidence > bestConfidence) {
                    bestTranscript = alternative.transcript;
                    bestConfidence = confidence;
                }
            }
            
            console.log('📝 أفضل نتيجة:', bestTranscript, '(ثقة:', (bestConfidence * 100).toFixed(1) + '%)');
            console.log('🎯 الحقل المستهدف:', this.targetField);
            
            // التحقق من جودة النتيجة
            if (bestConfidence < 0.5) {
                console.warn('⚠️ الثقة منخفضة، قد تحتاج للتحدث بوضوح أكبر');
                if (window.showCustomAlert) {
                    showCustomAlert('🔇 جودة الصوت منخفضة<br>يرجى التحدث بوضوح أقرب من الميكروفون', 'warning');
                }
            }
            
            // تطبيق التدقيق الإملائي المحسن للأسماء الطويلة
            if (this.targetField === 'productName') {
                this.processMedicationName(bestTranscript);
            } else {
                this.processSingleFieldInput(bestTranscript, this.targetField);
            }
        };
        
        this.recognition.onerror = (event) => {
            console.error('❌ خطأ في الإدخال الصوتي:', event.error);
            this.handleError(event.error);
            
            // معالجة خاصة لمشاكل الميكروفون
            if (event.error === 'not-allowed') {
                console.warn('🚫 تم رفض إذن الميكروفون');
                if (window.showCustomAlert) {
                    showCustomAlert('🚫 <strong>تم رفض إذن الميكروفون!</strong><br>يرجى السماح بالوصول للميكروفون في إعدادات المتصفح', 'error');
                }
            } else if (event.error === 'no-speech') {
                console.warn('🔇 لم يتم اكتشاف أي صوت');
                if (window.showCustomAlert) {
                    showCustomAlert('🔇 <strong>لم يتم اكتشاف أي صوت</strong><br>يرجى التحدث بوضوح في الميكروفون', 'warning');
                }
            } else if (event.error === 'audio-capture') {
                console.warn('🎤 لا يمكن الوصول للميكروفون');
                if (window.showCustomAlert) {
                    showCustomAlert('🎤 <strong>لا يمكن الوصول للميكروفون!</strong><br>يرجى التحقق من إعدادات الميكروفون', 'error');
                }
            }
        };
        
        this.recognition.onend = () => {
            console.log('🔇 انتهى الاستماع');
            this.updateButtonState(false);
        };
    }
    
    async startListening(targetField = null) {
        if (!this.recognition) {
            console.error('❌ التعرف الصوتي غير مهيأ');
            return;
        }
        
        try {
            // طلب إذن الميكروفون أولاً (مهم جداً للمتصفحات الحديثة)
            console.log('🔐 طلب إذن الميكروفون...');
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100,
                    channelCount: 1
                },
                video: false 
            });
            console.log('✅ تم الحصول على إذن الميكروفون');
            
            // إيقاف الـ stream مباشرة (نحتاج فقط للإذن)
            stream.getTracks().forEach(track => track.stop());
            
            this.targetField = targetField;
            
            // تعيين اللغة حسب الحقل المستهدف مع إعدادات محسنة للدقة
            if (targetField === 'productName') {
                // إعدادات محسنة للتعرف على أسماء الأدوية
                this.recognition.lang = 'en-US';
                this.recognition.continuous = false;
                this.recognition.interimResults = false;
                this.recognition.maxAlternatives = 3; // زيادة البدائل للدقة الأفضل
                console.log('🌐 تم تعيين لغة التعرف الصوتي إلى en-US لحقل اسم المنتج (إعدادات محسنة)');
            } else {
                this.recognition.lang = 'ar-EG';
                this.recognition.continuous = false;
                this.recognition.interimResults = false;
                this.recognition.maxAlternatives = 1;
                console.log('🌐 تم تعيين لغة التعرف الصوتي إلى ar-EG للحقول الأخرى');
            }
            
            this.autoRepeatEnabled = false;
            this.recognition.start();
            this.isListening = true;
            console.log('🎤 بدأ الاستماع بنجاح');
            
        } catch (error) {
            console.error('❌ فشل في بدء الاستماع:', error);
            
            // معالجة أخطاء الإذن
            if (error.name === 'NotAllowedError') {
                console.error('❌ تم رفض إذن الميكروفون');
                if (window.showCustomAlert) {
                    showCustomAlert('❌ تم رفض إذن الميكروفون<br>يرجى السماح بالوصول في إعدادات المتصفح', 'error');
                }
            } else if (error.name === 'NotFoundError') {
                console.error('❌ لم يتم العثور على ميكروفون');
                if (window.showCustomAlert) {
                    showCustomAlert('❌ لم يتم العثور على ميكروفون<br>يرجى توصيل ميكروفون', 'error');
                }
            } else {
                if (window.showCustomAlert) {
                    showCustomAlert('❌ خطأ في الميكروفون: ' + error.message, 'error');
                }
            }
        }
    }
    
    stopListening() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
            this.isListening = false;
        }
    }
    
    // معالجة متخصصة لأسماء الأدوية مع تدقيق إملائي محسن
    async processMedicationName(transcript) {
        console.log(`💊 معالجة اسم الدواء: "${transcript}"`);
        
        try {
            // عرض رسالة تحميل للمستخدم
            if (window.showCustomAlert) {
                showCustomAlert('🔍 جاري التحقق من اسم الدواء...', 'info');
            }
            
            let finalName = transcript;
            
            // 1. استخدام المدقق الإملائي المحسن أولاً
            if (window.medicationSpellChecker) {
                try {
                    finalName = await window.medicationSpellChecker.checkSpelling(transcript);
                    if (finalName !== transcript) {
                        console.log('✅ تم تصحيح اسم الدواء:', transcript, '->', finalName);
                        if (window.showCustomAlert) {
                            showCustomAlert(`✅ تم تصحيح اسم الدواء إلى: ${finalName}`, 'success');
                        }
                    } else {
                        console.log('✅ اسم الدواء صحيح:', transcript);
                        if (window.showCustomAlert) {
                            showCustomAlert('✅ اسم الدواء صحيح', 'success');
                        }
                    }
                } catch (spellError) {
                    console.warn('⚠️ المدقق الإملائي فشل:', spellError.message);
                }
            }
            
            // 2. التحقق الإضافي عبر RxNav إذا فشل المدقق
            if (finalName === transcript) {
                try {
                    const rxnavResponse = await fetch(`https://rxnav.nlm.nih.gov/REST/spellcheck?name=${encodeURIComponent(transcript)}`);
                    const rxnavData = await rxnavResponse.json();
                    
                    if (rxnavData.suggestions?.suggestion?.length > 0) {
                        const suggestedTerm = rxnavData.suggestions.suggestion[0].suggestedTerm;
                        if (suggestedTerm !== finalName) {
                            finalName = suggestedTerm;
                            console.log('🔤 تم التصحيح الإضافي عبر RxNav:', suggestedTerm);
                            if (window.showCustomAlert) {
                                showCustomAlert(`✅ تم تصحيح اسم الدواء إلى: ${finalName}`, 'success');
                            }
                        }
                    }
                } catch (rxnavError) {
                    console.warn('⚠️ RxNav فشل:', rxnavError.message);
                }
            }
            
            // 3. تحديث حقل اسم المنتج بالنتيجة النهائية
            const productField = document.getElementById('productName');
            if (productField) {
                productField.value = finalName;
                // تشغيل أحداث التحقق من صحة النموذج
                productField.dispatchEvent(new Event('input', { bubbles: true }));
                productField.dispatchEvent(new Event('change', { bubbles: true }));
                productField.dispatchEvent(new Event('blur', { bubbles: true }));
            }
            
            // 4. حفظ النتيجة في البيانات
            const data = { productName: finalName };
            this.fillFields(data);
            this.showResult(data);
            
        } catch (error) {
            console.error('❌ خطأ في معالجة اسم الدواء:', error);
            
            // استخدام النص الأصلي كخيار احتياطي
            const fallbackData = { productName: transcript };
            this.fillFields(fallbackData);
            this.showResult(fallbackData);
        }
    }
    
    processSingleFieldInput(transcript, fieldId) {
        console.log(`🎯 معالجة الإدخال الصوتي لحقل محدد [${fieldId}]:`, transcript);
        
        const conversion = this.arabicNumberConverter.extractNumbersAndWords(transcript);
        const lowerText = conversion.convertedText.toLowerCase();
        const data = {};
        
        switch(fieldId) {
            case 'quantity':
            case 'discount':
                const numMatch = lowerText.match(/\d+(?:\.\d+)?/);
                if (numMatch) data[fieldId] = numMatch[0];
                break;
            case 'price':
            case 'priceInt':
            case 'priceFrac':
                console.log(`🔍 البحث عن كسر مصري في: "${transcript}"`);
                
                // معالجة الكسور العشرية بالعامية المصرية: "مية وسبعتاشر وتسعتاشر من مية"
                // نتحقق من النص الأصلي قبل التحويل
                const egyptianFractionMatch = /(\S+?)\s*و\s*(\S+?)\s*و\s*(\S+?)\s*من\s*(?:مئة|ميه|مية|100)\b/gi.exec(transcript);
                console.log(`🔍 نتيجة البحث عن كسر مصري:`, egyptianFractionMatch);
                
                if (egyptianFractionMatch && fieldId === 'price') {
                    const n1 = this.arabicNumberConverter.convertSingleNumber(egyptianFractionMatch[1]) || 0;
                    const n2 = this.arabicNumberConverter.convertSingleNumber(egyptianFractionMatch[2]) || 0;
                    const n3 = this.arabicNumberConverter.convertSingleNumber(egyptianFractionMatch[3]) || 0;
                    const whole = n1 + n2;
                    const fraction = n3 / 100;
                    data[fieldId] = (whole + fraction).toFixed(2);
                    console.log(`✅ تم تحويل الكسر المصري: ${transcript} → ${data[fieldId]} (n1=${n1}, n2=${n2}, n3=${n3})`);
                    break;
                }
                
                // معالجة "فاصلة": "مية وسبعتاشر فاصلة تسعتاشر" → 117.19
                const commaMatch = /(\S+?)\s*و\s*(\S+?)\s*(?:فاصلة|نقطة)\s*(\S+)/gi.exec(transcript);
                console.log(`🔍 نتيجة البحث عن فاصلة:`, commaMatch);
                
                if (commaMatch && fieldId === 'price') {
                    const n1 = this.arabicNumberConverter.convertSingleNumber(commaMatch[1]) || 0;
                    const n2 = this.arabicNumberConverter.convertSingleNumber(commaMatch[2]) || 0;
                    const n3 = this.arabicNumberConverter.convertSingleNumber(commaMatch[3]) || 0;
                    const whole = n1 + n2;
                    const fraction = n3 / 100;
                    data[fieldId] = (whole + fraction).toFixed(2);
                    console.log(`✅ تم تحويل الفاصلة: ${transcript} → ${data[fieldId]} (n1=${n1}, n2=${n2}, n3=${n3})`);
                    break;
                }
                
                // نمط مبسط: "مئة وسبعتاشر من مية"
                const simpleFractionMatch = /(\S+?)\s*و\s*(\S+?)\s*من\s*(?:مئة|ميه|مية|100)\b/gi.exec(transcript);
                console.log(`🔍 نتيجة البحث عن كسر مبسط:`, simpleFractionMatch);
                
                if (simpleFractionMatch && fieldId === 'price') {
                    const n1 = this.arabicNumberConverter.convertSingleNumber(simpleFractionMatch[1]) || 0;
                    const n2 = this.arabicNumberConverter.convertSingleNumber(simpleFractionMatch[2]) || 0;
                    const fraction = n2 / 100;
                    data[fieldId] = (n1 + fraction).toFixed(2);
                    console.log(`✅ تم تحويل الكسر المبسط: ${transcript} → ${data[fieldId]} (n1=${n1}, n2=${n2})`);
                    break;
                }
                
                // نمط أبسط: "مئة من مية" أو "مئة من مية وسبعتاشر"
                const evenSimplerMatch = /(\S+?)\s*من\s*(?:مئة|ميه|مية|100)(?:\s*و\s*(\S+))?\b/gi.exec(transcript);
                console.log(`🔍 نتيجة البحث عن نمط أبسط:`, evenSimplerMatch);
                
                if (evenSimplerMatch && fieldId === 'price') {
                    const n1 = this.arabicNumberConverter.convertSingleNumber(evenSimplerMatch[1]) || 0;
                    let fraction = 0;
                    if (evenSimplerMatch[2]) {
                        const n2 = this.arabicNumberConverter.convertSingleNumber(evenSimplerMatch[2]) || 0;
                        fraction = n2 / 100;
                    }
                    data[fieldId] = (n1 + fraction).toFixed(2);
                    console.log(`✅ تم تحويل النمط الأبسط: ${transcript} → ${data[fieldId]} (n1=${n1}, n2=${evenSimplerMatch[2]})`);
                    break;
                }
                
                // استخدام مكتبة تحويل الأرقام العربية للتعرف على الأرقام العامية المعقدة
                const priceNumberMatch = lowerText.match(/\d+/);
                if (priceNumberMatch) {
                    let numValue = parseInt(priceNumberMatch[0], 10);
                    // للحقل priceFrac، تأكد من أن القيمة بين 0 و 99
                    if (fieldId === 'priceFrac' && (numValue < 0 || numValue > 99)) {
                        numValue = Math.max(0, Math.min(99, numValue));
                    }
                    data[fieldId] = numValue.toString();
                } else {
                    // محاولة تحويل الأرقام العامية المعقدة مثل "مية وتسعتاشر"
                    const conversion = this.arabicNumberConverter.extractNumbersAndWords(lowerText);
                    if (conversion.numbers && conversion.numbers.length > 0) {
                        // استخدام أول رقم تم استخرجه
                        let numValue = conversion.numbers[0].number;
                        // للحقل priceFrac، تأكد من أن القيمة بين 0 و 99
                        if (fieldId === 'priceFrac' && (numValue < 0 || numValue > 99)) {
                            numValue = Math.max(0, Math.min(99, numValue));
                        }
                        data[fieldId] = numValue.toString();
                    } else {
                        // محاولة التحويل البسيط كخيار احتياطي
                        const arabicNumber = this.arabicNumberConverter.convertSingleNumber(lowerText.trim());
                        if (arabicNumber !== null) {
                            let numValue = arabicNumber;
                            // للحقل priceFrac، تأكد من أن القيمة بين 0 و 99
                            if (fieldId === 'priceFrac' && (numValue < 0 || numValue > 99)) {
                                numValue = Math.max(0, Math.min(99, numValue));
                            }
                            data[fieldId] = numValue.toString();
                        }
                    }
                }
                break;
            case 'prodDate':
            case 'expDate':
                const datePattern = /\b([1-9]|[12][0-9]|3[01])\s*(?:و|-|\/|\.| )?\s*([1-9]|1[0-2])\s*(?:و|-|\/|\.| )?\s*(20[0-3][0-9])\b/;
                const dateMatch = lowerText.match(datePattern);
                if (dateMatch) {
                    data[fieldId] = {
                        day: dateMatch[1].padStart(2, '0'),
                        month: dateMatch[2].padStart(2, '0'),
                        year: dateMatch[3]
                    };
                }
                break;
        }
        
        if (Object.keys(data).length === 0) {
            const fallbackNumber = this.arabicNumberConverter.parseArabicNumber(lowerText);
            if (fallbackNumber !== null) {
                if (fieldId === 'price' || fieldId === 'priceInt' || fieldId === 'priceFrac') {
                    if (fieldId === 'price') {
                        data.price = fallbackNumber.toString();
                    } else {
                        data[fieldId] = fallbackNumber.toString();
                    }
                } else if (fieldId === 'productName') {
                    data.productName = transcript.trim();
                } else if (['quantity', 'discount', 'prodDay', 'prodMonth', 'expDay', 'expMonth'].includes(fieldId)) {
                    data[fieldId] = fallbackNumber.toString();
                } else if (fieldId === 'prodYear' || fieldId === 'expYear') {
                    data[fieldId] = (fallbackNumber >= 0 && fallbackNumber <= 30) ? (2000 + fallbackNumber).toString() : fallbackNumber.toString();
                }
            }
        }

        this.fillFields(data);
        this.showResult(data);
        this.targetField = null; // إنهاء التوجيه
        this.updateButtonState(false);
    }
    
    updateButtonState(listening) {
        if (this.voiceBtn) {
            if (listening && !this.targetField) {
                // استماع عام
                this.voiceBtn.classList.add('listening');
                this.voiceBtn.innerHTML = '<i class="fas fa-stop"></i> إيقاف التسجيل';
            } else {
                this.voiceBtn.classList.remove('listening');
                this.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i> إدخال صوتي';
            }
        }
        
        if (this.fieldMicBtns) {
            this.fieldMicBtns.forEach(btn => {
                const fieldName = btn.getAttribute('data-field');
                if (listening && this.targetField === fieldName) {
                    btn.classList.add('listening');
                    btn.innerHTML = '<i class="fas fa-stop"></i>';
                } else {
                    btn.classList.remove('listening');
                    btn.innerHTML = '<i class="fas fa-microphone"></i>';
                }
            });
        }
    }
    
    processVoiceResult(transcript) {
        console.log('🧠 معالجة النص v10.1:', transcript);
        
        try {
            // تحويل متقدم مع Real-time processing
            const conversion = this.arabicNumberConverter.extractNumbersAndWords(transcript);
            
            console.log('⚡ Real-time conversion completed:', conversion);
            
            // تحليل ذكي للبيانات
            const processed = this.analyzeInput(conversion);
            
            // تصحيح أسماء الأدوية لحقل المنتج
            if (processed.productName && this.targetField === 'productName') {
                if (typeof this.correctMedicineName === 'function') {
                    processed.productName = this.correctMedicineName(processed.productName);
                } else {
                    console.warn('⚠️ وظيفة correctMedicineName غير متوفرة، يتم استخدام الاسم كما هو');
                }
            }
            
            console.log('🎯 البيانات بعد التحليل:', processed);
            
            // ملء الحقول تلقائياً
            this.fillFields(processed, this.targetField);
            
            // عرض النتيجة للمستخدم
            this.showResult(processed);
        } catch (error) {
            console.error('❌ خطأ في معالجة الإدخال الصوتي:', error);
            
            // Fallback: محاولة ملء البيانات مباشرة من النص
            this.fallbackFillFields(transcript);
        }
    }
    
    // ملء الحقول كـ fallback في حالة فشل التحليل المتقدم
    fallbackFillFields(transcript) {
        console.log('🔄 استخدام fallback لملء الحقول...');
        
        const data = { productName: '', price: '', quantity: '', discount: '' };
        const lowerTranscript = transcript.toLowerCase();
        
        // معالجة الكسور العشرية بالعامية المصرية أولاً
        const egyptianFractionMatch = /(\S+?)\s*و\s*(\S+?)\s*و\s*(\S+?)\s*من\s*(?:مئة|ميه|مية|100)\b/gi.exec(transcript);
        if (egyptianFractionMatch) {
            const n1 = this.arabicNumberConverter.convertSingleNumber(egyptianFractionMatch[1]) || 0;
            const n2 = this.arabicNumberConverter.convertSingleNumber(egyptianFractionMatch[2]) || 0;
            const n3 = this.arabicNumberConverter.convertSingleNumber(egyptianFractionMatch[3]) || 0;
            const whole = n1 + n2;
            const fraction = n3 / 100;
            data.price = (whole + fraction).toFixed(2);
            console.log(`✅ Fallback: تحويل الكسر المصري: ${transcript} → ${data.price}`);
        }
        
        // معالجة "فاصلة"
        const commaMatch = /(\S+?)\s*و\s*(\S+?)\s*(?:فاصلة|نقطة)\s*(\S+)/gi.exec(transcript);
        if (commaMatch && !data.price) {
            const n1 = this.arabicNumberConverter.convertSingleNumber(commaMatch[1]) || 0;
            const n2 = this.arabicNumberConverter.convertSingleNumber(commaMatch[2]) || 0;
            const n3 = this.arabicNumberConverter.convertSingleNumber(commaMatch[3]) || 0;
            const whole = n1 + n2;
            const fraction = n3 / 100;
            data.price = (whole + fraction).toFixed(2);
            console.log(`✅ Fallback: تحويل الفاصلة: ${transcript} → ${data.price}`);
        }
        
        // نمط مبسط
        const simpleFractionMatch = /(\S+?)\s*و\s*(\S+?)\s*من\s*(?:مئة|ميه|مية|100)\b/gi.exec(transcript);
        if (simpleFractionMatch && !data.price) {
            const n1 = this.arabicNumberConverter.convertSingleNumber(simpleFractionMatch[1]) || 0;
            const n2 = this.arabicNumberConverter.convertSingleNumber(simpleFractionMatch[2]) || 0;
            const fraction = n2 / 100;
            data.price = (n1 + fraction).toFixed(2);
            console.log(`✅ Fallback: تحويل الكسر المبسط: ${transcript} → ${data.price}`);
        }
        
        // نمط أبسط: "مئة من مية" أو "مئة من مية وسبعتاشر"
        const evenSimplerMatch = /(\S+?)\s*من\s*(?:مئة|ميه|مية|100)(?:\s*و\s*(\S+))?\b/gi.exec(transcript);
        if (evenSimplerMatch && !data.price) {
            const n1 = this.arabicNumberConverter.convertSingleNumber(evenSimplerMatch[1]) || 0;
            let fraction = 0;
            if (evenSimplerMatch[2]) {
                const n2 = this.arabicNumberConverter.convertSingleNumber(evenSimplerMatch[2]) || 0;
                fraction = n2 / 100;
            }
            data.price = (n1 + fraction).toFixed(2);
            console.log(`✅ Fallback: تحويل النمط الأبسط: ${transcript} → ${data.price}`);
        }
        
        // استخراج الأرقام من النص
        const numbers = transcript.match(/\d+/g) || [];
        
        // استخراج الكلمات غير الرقمية كاسم منتج
        const words = transcript.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
        // إزالة الكلمات المفتاحية
        const keywords = ['سعر', 'جنيه', 'جنية', 'كمية', 'عدد', 'قطعة', 'خصم', 'بسعر', 'ب'];
        let productName = words;
        keywords.forEach(kw => { productName = productName.replace(new RegExp(kw, 'gi'), ''); });
        productName = productName.replace(/\s+/g, ' ').trim();
        
        if (productName) data.productName = productName;
        
        // الرقم الأول = كمية
        if (!data.quantity && numbers.length >= 1) data.quantity = numbers[0];
        
        // السعر فقط إذا لم يتم تحويله بالكسر وذُكرت عملة صريحة
        if (!data.price) {
            const currencyWords = ['جنيه', 'جنية', 'ريال', 'دولار'];
            const hasCurrency = currencyWords.some(w => lowerTranscript.includes(w));
            
            if (hasCurrency && numbers.length >= 2) {
                data.price = numbers[1];
            }
        }
        
        if (numbers.length >= 3) data.discount = numbers[2];
        
        console.log('🔄 Fallback data:', data);
        
        this.fillFields(data);
        this.showResult(data);
    }
    
    repeatCommand(transcript) {
        console.log('🛑 تم تعطيل التكرار الصوتي:', transcript);
    }
    
    analyzeInput(conversion) {
        const result = {
            productName: '',
            price: '',
            quantity: '',
            discount: '',
            numbers: [],
            words: [],
            confidence: 0
        };
        
        let lowerText = conversion.convertedText.toLowerCase();
        console.log('🧠 تحليل الجملة (لا يعتمد على الترتيب):', lowerText);
        
        // -1. المحلل الموضعي الصارم (الاعتماد على ترتيب الحقول المباشر دون تفوه بأسماء الحقول)
        // الأنماط المدعومة:
        // [كمية] [منتج] [سعر] [خصم] [تاريخ إنتاج] [تاريخ انتهاء]
        // [كمية] [منتج] [سعر] [خصم]
        // [كمية] [منتج] [سعر]
        
        const numP = /(\d+)/.source;
        const prodP = /(.+?)/.source;
        const priceP = /(\d+(?:\s*و\s*\d+\s*(?:من|على)\s*(?:مية|ميه|100|1000)|\.\d+)?)(?:\s*(?:جنيه|جنية|ريال|دولار|ب))?/.source;
        const dateP = /(\d{1,2}(?:\s|-|\/|\.|و)\s*\d{1,2}(?:\s|-|\/|\.|و)\s*\d{4})/.source;

        const sixPosPattern = new RegExp(`^${numP}\\s+${prodP}\\s+${priceP}\\s+${numP}\\s+${dateP}\\s+${dateP}$`, "i");
        const fourPosPattern = new RegExp(`^${numP}\\s+${prodP}\\s+${priceP}\\s+${numP}$`, "i");
        const threePosPattern = new RegExp(`^${numP}\\s+${prodP}\\s+${priceP}$`, "i");

        const parseDate = (dStr) => {
            const p = dStr.split(/[\s\-\/\.و]+/);
            return { day: p[0].padStart(2, '0'), month: p[1].padStart(2, '0'), year: p[2] };
        };

        const match6 = lowerText.trim().match(sixPosPattern);
        if (match6) {
            console.log("✅ تم التعرف على النمط الموضعي الكامل (6 حقول)");
            result.quantity = match6[1];
            const potentialName = match6[2].trim();
            result.productName = this.arabicNumberConverter.productDatabase[potentialName] || potentialName;
            
            let priceStr = match6[3];
            const fractionMatch = /(\d+)\s*و\s*(\d+)\s*(?:من|على)\s*(?:مية|ميه|100|1000)/.exec(priceStr);
            result.price = fractionMatch ? `${fractionMatch[1]}.${fractionMatch[2].padStart(2, '0')}` : priceStr;
            
            result.discount = match6[4];
            result.prodDate = parseDate(match6[5]);
            result.expDate = parseDate(match6[6]);
            return result;
        }

        const match4 = lowerText.trim().match(fourPosPattern);
        if (match4) {
            console.log("✅ تم التعرف على النمط الموضعي (4 حقول)");
            result.quantity = match4[1];
            const potentialName = match4[2].trim();
            result.productName = this.arabicNumberConverter.productDatabase[potentialName] || potentialName;
            
            let priceStr = match4[3];
            const fractionMatch = /(\d+)\s*و\s*(\d+)\s*(?:من|على)\s*(?:مية|ميه|100|1000)/.exec(priceStr);
            result.price = fractionMatch ? `${fractionMatch[1]}.${fractionMatch[2].padStart(2, '0')}` : priceStr;
            
            result.discount = match4[4];
            return result;
        }

        const match3 = lowerText.trim().match(threePosPattern);
        if (match3) {
            console.log("✅ تم التعرف على النمط الموضعي (3 حقول)");
            result.quantity = match3[1];
            const potentialName = match3[2].trim();
            result.productName = this.arabicNumberConverter.productDatabase[potentialName] || potentialName;
            
            let priceStr = match3[3];
            const fractionMatch = /(\d+)\s*و\s*(\d+)\s*(?:من|على)\s*(?:مية|ميه|100|1000)/.exec(priceStr);
            result.price = fractionMatch ? `${fractionMatch[1]}.${fractionMatch[2].padStart(2, '0')}` : priceStr;
            
            return result;
        }
        
        // 0. الاستخراج الهيكلي المباشر (عندما يذكر المستخدم اسم الحقل ثم قيمته)
        // مثل: "الكمية 117 المنتج بانادول السعر 13 و 15 من 100 الخصم 17"
        
        let structMatch;
        // استخراج الكمية
        if ((structMatch = /(?:الكمية|كمية)\s+(\d+)/g.exec(lowerText)) !== null) {
            result.quantity = structMatch[1];
            lowerText = lowerText.replace(structMatch[0], ' ');
            console.log(`✅ تم استخراج الكمية هيكلياً: ${result.quantity}`);
        }
        
        // استخراج الخصم
        if ((structMatch = /(?:الخصم|خصم)\s+(\d+)(?:\s*(?:في المئة|في الميه|فى المية|في المية|%))?/g.exec(lowerText)) !== null) {
            result.discount = structMatch[1];
            lowerText = lowerText.replace(structMatch[0], ' ');
            console.log(`✅ تم استخراج الخصم هيكلياً: ${result.discount}`);
        }
        
        // استخراج السعر (يدعم الأرقام الصحيحة والكسور مثل "13 و 15 من 100" أو "13.15")
        if ((structMatch = /(?:السعر|سعر)\s+(\d+(?:\s*و\s*\d+\s*(?:من|على)\s*(?:مية|ميه|100|1000)|\.\d+)?)(?:\s*(?:جنيه|جنية|ريال|دولار))?/g.exec(lowerText)) !== null) {
            let priceStr = structMatch[1];
            // تحويل "13 و 15 من 100" إلى "13.15"
            const fractionMatch = /(\d+)\s*و\s*(\d+)\s*(?:من|على)\s*(?:مية|ميه|100|1000)/.exec(priceStr);
            if (fractionMatch) {
                result.price = `${fractionMatch[1]}.${fractionMatch[2].padStart(2, '0')}`;
            } else {
                result.price = priceStr;
            }
            lowerText = lowerText.replace(structMatch[0], ' ');
            console.log(`✅ تم استخراج السعر هيكلياً: ${result.price}`);
        }
        
        // استخراج المنتج
        // يستخرج النص بعد كلمة المنتج أو الصنف حتى يجد إحدى الكلمات المفتاحية الأخرى أو نهاية النص
        if ((structMatch = /(?:المنتج|صنف|الصنف)\s+(.*?)(?=\s+(?:الكمية|كمية|السعر|سعر|الخصم|خصم|الانتاج|إنتاج|تاريخ|الانتهاء|انتهاء|$))/g.exec(lowerText)) !== null) {
            const potentialName = structMatch[1].trim();
            if (potentialName) {
                result.productName = this.arabicNumberConverter.productDatabase[potentialName] || potentialName;
                lowerText = lowerText.replace(structMatch[0], ' ');
                console.log(`✅ تم استخراج اسم المنتج هيكلياً: ${result.productName}`);
            }
        }
        
        // 1. استخراج التواريخ (مستقل الترتيب تماماً)
        const datePattern = /\b([1-9]|[12][0-9]|3[01])\s*(?:و|-|\/|\.| )?\s*([1-9]|1[0-2])\s*(?:و|-|\/|\.| )?\s*(20[0-3][0-9])\b/g;
        const foundDates = [];
        let dateMatch;
        while ((dateMatch = datePattern.exec(lowerText)) !== null) {
            // التقاط السياق الذي يسبق التاريخ بـ 25 حرفاً لمعرفة هويته
            const prefixContext = lowerText.substring(Math.max(0, dateMatch.index - 25), dateMatch.index);
            const isExpiryContext = /انتهاء|صلاحية|صلاحيه|ينتهي/.test(prefixContext);
            const isProdContext = /انتاج|إنتاج/.test(prefixContext);
            
            foundDates.push({
                day: dateMatch[1].padStart(2, '0'),
                month: dateMatch[2].padStart(2, '0'),
                year: dateMatch[3],
                fullMatch: dateMatch[0],
                isExpiryContext,
                isProdContext
            });
            console.log(`📅 وجد تاريخ: ${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]} | انتهاء: ${isExpiryContext} | انتاج: ${isProdContext}`);
        }
        
        // تعيين التواريخ بذكاء
        for (let i = 0; i < foundDates.length; i++) {
            const dataDate = foundDates[i];
            lowerText = lowerText.replace(dataDate.fullMatch, ' '); // إزالة من النص
            
            if (dataDate.isExpiryContext) {
                result.expDate = dataDate;
            } else if (dataDate.isProdContext) {
                result.prodDate = dataDate;
            } else {
                // في غياب الكلمات المفتاحية
                if (foundDates.length === 2 && i === 0) {
                    result.prodDate = dataDate; // إذا كان هناك تاريخين، الأول دائماً انتاج
                } else if (foundDates.length === 2 && i === 1) {
                    result.expDate = dataDate; // الثاني انتهاء
                } else if (foundDates.length === 1) {
                    // إذا ذُكر تاريخ واحد فقط بدون كلمات مفتاحية، غالباً يكون انتهاء في الصيدليات!
                    result.expDate = dataDate;
                }
            }
        }
        
        // 2. استخراج السعر (يُعرف آلياً إذا كان كسراً دون الحاجة لكلمة مفتاحية، وإلا يتطلب عملة أو كلمة 'سعر')
        const priceKeywords = ['جنيه', 'جنية', 'ريال', 'دولار', 'بجنيه', 'بجنية', 'جنيهات'];
        const hasCurrencyWord = priceKeywords.some(w => lowerText.includes(w));
        
        // أولاً: البحث عن الكسور العشرية المعقدة إذا وجدت (مثال: 115 و 13 من 100) - تكون حصرياً لمربع السعر
        if (conversion.decimalInfo && lowerText.includes(conversion.decimalInfo.text.toLowerCase())) {
            if (!result.price) result.price = conversion.decimalInfo.value.toString();
            lowerText = lowerText.replace(conversion.decimalInfo.text.toLowerCase(), ' ');
            for (const kw of priceKeywords) lowerText = lowerText.replace(new RegExp(kw, 'gi'), ' '); // تنظيف الكلمات إن وجدت
            console.log(`💰 تم تعيين السعر العشري (كاحتياطي): ${result.price}`);
        } else if (hasCurrencyWord) {
            // ثانياً: البحث عن السعر العادي إذا ذكر عملة (مثال: 115 جنيه)
                for (let keyword of priceKeywords) {
                    const priceRegex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${keyword}`, 'i');
                    const match = lowerText.match(priceRegex);
                    if (match) {
                        if (!result.price) result.price = match[1];
                        lowerText = lowerText.replace(match[0], ' '); 
                        console.log(`💰 تم تعيين السعر العادي: ${result.price}`);
                        break;
                    }
                    
                    const priceRegexRev = new RegExp(`${keyword}\\s*(\\d+(?:\\.\\d+)?)`, 'i');
                    const matchRev = lowerText.match(priceRegexRev);
                    if (matchRev) {
                        if (!result.price) result.price = matchRev[1];
                        lowerText = lowerText.replace(matchRev[0], ' '); 
                        console.log(`💰 تم تعيين السعر المعكوس: ${result.price}`);
                        break;
                    }
                }
            }
        
        // 3. استخراج الخصم (من أي ترتيب)
        const discountKeywords = ['خصم', 'تخفيض', 'نسبة', 'في المئة', 'في الميه', 'فى المية', 'في المية', '%'];
        lowerText = lowerText.replace(/\s*%\s*/g, ' % '); 
        for (let keyword of discountKeywords) {
            const escapeKw = keyword === '%' ? '%' : keyword; 
            const regex1 = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${escapeKw}`, 'i');
            const match1 = lowerText.match(regex1);
            if (match1) {
                if (!result.discount) result.discount = match1[1];
                lowerText = lowerText.replace(match1[0], ' ');
                console.log(`🏷️ تم تعيين الخصم: ${result.discount}`);
                break;
            }
            
            const regex2 = new RegExp(`(?:${escapeKw})\\s*(\\d+(?:\\.\\d+)?)`, 'i');
            const match2 = lowerText.match(regex2);
            if (match2) {
                if (!result.discount) result.discount = match2[1];
                lowerText = lowerText.replace(match2[0], ' ');
                console.log(`🏷️ تم تعيين الخصم المعكوس: ${result.discount}`);
                break;
            }
        }
        
        // 4. استخراج الكمية (بالأرقام المتبقية أو بالكلمة المفتاحية)
        const quantityKeywords = ['كمية', 'عدد', 'قطعة', 'قطع', 'صندوق', 'صناديق', 'كرتونة', 'كراتين', 'علبة', 'شريط'];
        for (let keyword of quantityKeywords) {
            const regex = new RegExp(`(\\d+)\\s*${keyword}`, 'i');
            const match = lowerText.match(regex);
            if (match) {
                if (!result.quantity) result.quantity = match[1];
                lowerText = lowerText.replace(match[0], ' ');
                console.log(`📦 تم تعيين الكمية مفتاحياً: ${result.quantity}`);
                break;
            }
            
            const regexRev = new RegExp(`(?:${keyword})\\s*(\\d+)`, 'i');
            const matchRev = lowerText.match(regexRev);
            if (matchRev) {
                if (!result.quantity) result.quantity = matchRev[1];
                lowerText = lowerText.replace(matchRev[0], ' ');
                console.log(`📦 تم تعيين الكمية مفتاحياً معكوساً: ${result.quantity}`);
                break;
            }
        }

        // إذا لم نجد كمية، الرقم المتبقي الوحيد وغالباً يسبق أو يلي كلمات هو الكمية!
        let remainingWords = lowerText.split(/\s+/).filter(w => w.trim() !== '');
        if (!result.quantity) {
            // لا نلتقط رقماً عشوائياً ككمية إلا إذا كان حقل الكمية فارغاً في الواجهة
            // هذا يمنع الأرقام العشوائية من تخريب الكميات المدخلة مسبقاً عند الاستكمال
            const qtInput = document.getElementById('quantity');
            const needsQuantity = !qtInput || qtInput.value.trim() === '';
            
            if (needsQuantity) {
                const remainingNumbers = remainingWords.filter(w => /^\d+$/.test(w));
                if (remainingNumbers.length > 0) {
                    result.quantity = remainingNumbers[0];
                    remainingWords = remainingWords.filter(w => w !== result.quantity);
                    console.log(`📦 تم تعيين الكمية بالاستبعاد (لأن الحقل فارغ): ${result.quantity}`);
                }
            } else {
                console.log(`⚠️ تم تجاهل الأرقام العشوائية ولم تعين ككمية لأن حقل الكمية ممتلئ مسبقاً.`);
            }
        }
        
        // 5. استخراج اسم المنتج (ما تبقى من النص)
        // إزالة الكلمات المفتاحية الزائدة التي قد تتبقى
        const junkWords = [...priceKeywords, ...discountKeywords, ...quantityKeywords, 'من', 'و', 'ب'];
        remainingWords = remainingWords.filter(w => !junkWords.includes(w) && !/^\d+$/.test(w));
        
        if (remainingWords.length > 0) {
            // محاولة إيجاد منتج مسجل بالاسم المتبقي
            const potentialName = remainingWords.join(' ').trim();
            const dbProduct = this.arabicNumberConverter.productDatabase[potentialName];
            
            if (!result.productName) {
                result.productName = dbProduct || potentialName;
                console.log(`💊 تم استخراج المنتج بالاستبعاد: ${result.productName}`);
            } else if (dbProduct) {
                // الاستبدال فقط إذا كنا متأكدين 100% أن الكلمات المتبقية هي منتج صريح مسجل
                result.productName = dbProduct;
                console.log(`💊 تم تصحيح المنتج بالاستبعاد لأنه مسجل بقاعدة البيانات: ${result.productName}`);
            }
        } else {
            // كخيار أخير في حال مسح كل شيء، نبحث بذكاء
            if (!result.productName) {
                this.extractProductAndQuantity(conversion.convertedText, result);
            }
        }
        
        console.log('🎯 التدقيق الشامل للبيانات المستخرجة:', result);
        return result;
    }

    // تحليل الجمل المعقدة
    parseComplexSentence(text, result) {
        console.log('🔍 تحليل الجملة المعقدة:', text);
        
        // نمط الجملة المعقدة: "مية وسبعتاشر بانادول تلاتاشر وستاشر من مية جنيه"
        const complexSentencePattern = /(\d+|\w+)\s+(و|plus|\+)\s+(\d+|\w+)\s+(\w+)\s+(\d+|\w+)\s+(و|plus|\+)\s+(\d+|\w+)\s+(من|of|\/|من)\s+(\d+|\w+)\s*(جنيه|ج|ريال|دولار|ب|جنية)?/gi;
        
        const match = complexSentencePattern.exec(text);
        if (match) {
            console.log('🎯 تم العثور على جملة معقدة:', match);
            
            // استخراج الأجزاء
            const quantityPart1 = this.parseArabicNumber(match[1]); // مية → 100
            const quantityPart2 = this.parseArabicNumber(match[3]); // سبعتاشر → 17
            const productName = match[4]; // بانادول
            const pricePart1 = this.parseArabicNumber(match[5]); // تلاتاشر → 13
            const pricePart2 = this.parseArabicNumber(match[7]); // ستاشر → 16 (تصحيح)
            const priceTotal = this.parseArabicNumber(match[9]); // مية → 100
            const currency = match[10] || 'جنيه'; // جنيه
            
            console.log('📊 الأجزاء المستخرجة:', {
                quantityPart1, quantityPart2, productName,
                pricePart1, pricePart2, priceTotal, currency
            });
            
            // حساب الكمية: مية وسبعتاشر = 117
            if (quantityPart1 && quantityPart2) {
                const quantity = quantityPart1 + quantityPart2;
                result.quantity = quantity.toString();
                console.log('✅ تم تعيين الكمية:', quantity);
            }
            
            // تعيين اسم المنتج
            if (productName && this.arabicNumberConverter.productDatabase[productName.toLowerCase()]) {
                result.productName = this.arabicNumberConverter.productDatabase[productName.toLowerCase()];
                console.log('✅ تم تعيين اسم المنتج:', result.productName);
            } else if (productName) {
                result.productName = productName;
                console.log('✅ تم تعيين اسم المنتج (عام):', productName);
            }
            
            // حساب السعر: تلاتاشر وستاشر من مية = 13.16 (تصحيح)
            if (pricePart1 && pricePart2 && priceTotal) {
                // التحقق إذا كان هذا كسر عشري دقيق
                if (pricePart1 < 50 && pricePart2 < 50 && priceTotal >= 100) {
                    const decimalPrice = parseFloat(`${pricePart1}.${pricePart2.toString().padStart(2, '0')}`);
                    const roundedPrice = this.roundToTwoDecimals(decimalPrice);
                    
                    result.price = roundedPrice.toString();
                    result.priceInfo = {
                        price: roundedPrice.toString(),
                        unit: currency,
                        expression: match[0],
                        calculation: `${pricePart1}.${pricePart2.toString().padStart(2, '0')} ${currency} (كسر عشري من ${priceTotal})`,
                        isFraction: true,
                        isDecimalFraction: true,
                        numerator: `${pricePart1}.${pricePart2.toString().padStart(2, '0')}`,
                        denominator: priceTotal.toString()
                    };
                    
                    console.log('✅ تم تعيين السعر العشري:', roundedPrice);
                } else {
                    // حساب كسر عادي
                    const sum = pricePart1 + pricePart2;
                    if (sum < priceTotal / 2) {
                        const calculated = (sum / priceTotal) * 100;
                        const roundedCalculated = this.roundToTwoDecimals(calculated);
                        
                        result.price = roundedCalculated.toString();
                        result.priceInfo = {
                            price: roundedCalculated.toString(),
                            totalPrice: priceTotal.toString(),
                            unit: currency,
                            expression: match[0],
                            calculation: `${sum} / ${priceTotal} * 100 = ${roundedCalculated} ${currency}`,
                            isFraction: true,
                            numerator: sum.toString(),
                            denominator: priceTotal.toString()
                        };
                        
                        console.log('✅ تم تعيين السعر الكسري:', roundedCalculated);
                    }
                }
            }
            
            return true; // تم العثور على جملة معقدة
        }
        
        return false; // لم يتم العثور على جملة معقدة
    }
    
    // تقريب الرقم إلى عشرتين فقط
    roundToTwoDecimals(num) {
        return Math.round(num * 100) / 100;
    }
    
    // استخراج السعر المباشر (رقم جنيه)
    extractDirectPrice(text, result) {
        console.log('💰 البحث عن سعر مباشر (رقم جنيه) في:', text);
        
        // أنماط السعر المباشر
        const directPricePatterns = [
            // "رقم جنيه" - النمط الأساسي
            {
                pattern: /(\d+|\w+)\s*(جنيه|ج|ريال|دولار|ب)\s*$/gi,
                calculator: (match) => {
                    const price = this.parseArabicNumber(match[1]);
                    const unit = match[2] || 'جنيه';
                    
                    if (price) {
                        console.log(`💰 وجد سعر مباشر: ${price} ${unit}`);
                        return {
                            price: price.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `${price} ${unit}`,
                            isDirect: true
                        };
                    }
                    return null;
                }
            },
            
            // "جنيه رقم" - النمط المعكوس
            {
                pattern: /^(جنيه|ج|ريال|دولار|ب)\s*(\d+|\w+)/gi,
                calculator: (match) => {
                    const unit = match[1];
                    const price = this.parseArabicNumber(match[2]);
                    
                    if (price) {
                        console.log(`💰 وجد سعر مباشر معكوس: ${unit} ${price}`);
                        return {
                            price: price.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `${unit} ${price}`,
                            isDirect: true
                        };
                    }
                    return null;
                }
            },
            
            // "رقم جنيه" في وسط الجملة
            {
                pattern: /(\d+|\w+)\s*(جنيه|ج|ريال|دولار|ب)(?!\s+(و|plus|\+|\d+|\w+))/gi,
                calculator: (match) => {
                    const price = this.parseArabicNumber(match[1]);
                    const unit = match[2];
                    
                    if (price) {
                        console.log(`💰 وجد سعر مباشر في وسط الجملة: ${price} ${unit}`);
                        return {
                            price: price.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `${price} ${unit}`,
                            isDirect: true
                        };
                    }
                    return null;
                }
            },
            
            // "السعر رقم جنيه"
            {
                pattern: /السعر\s+(\d+(?:\.\d+)?|\w+)\s*(جنيه|ج|ريال|دولار|ب)?/gi,
                calculator: (match) => {
                    const price = this.parseArabicNumber(match[1]);
                    const unit = match[2] || 'جنيه';
                    
                    if (price) {
                        console.log(`💰 وجد سعر مع كلمة "السعر": ${price} ${unit}`);
                        return {
                            price: price.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `السعر ${price} ${unit}`,
                            isDirect: true
                        };
                    }
                    return null;
                }
            },
            
            // "بسعر رقم جنيه"
            {
                pattern: /بسعر\s+(\d+(?:\.\d+)?|\w+)\s*(جنيه|ج|ريال|دولار|ب)/gi,
                calculator: (match) => {
                    const price = this.parseArabicNumber(match[1]);
                    const unit = match[2];
                    
                    if (price) {
                        console.log(`💰 وجد سعر مع كلمة "بسعر": ${price} ${unit}`);
                        return {
                            price: price.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `بسعر ${price} ${unit}`,
                            isDirect: true
                        };
                    }
                    return null;
                }
            },
            
            // "بقيمة رقم جنيه"
            {
                pattern: /بقيمة\s+(\d+(?:\.\d+)?|\w+)\s*(جنيه|ج|ريال|دولار|ب)/gi,
                calculator: (match) => {
                    const price = this.parseArabicNumber(match[1]);
                    const unit = match[2];
                    
                    if (price) {
                        console.log(`💰 وجد سعر مع كلمة "بقيمة": ${price} ${unit}`);
                        return {
                            price: price.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `بقيمة ${price} ${unit}`,
                            isDirect: true
                        };
                    }
                    return null;
                }
            },
            
            // "بمبلغ رقم جنيه"
            {
                pattern: /بمبلغ\s+(\d+|\w+)\s*(جنيه|ج|ريال|دولار|ب)/gi,
                calculator: (match) => {
                    const price = this.parseArabicNumber(match[1]);
                    const unit = match[2];
                    
                    if (price) {
                        console.log(`💰 وجد سعر مع كلمة "بمبلغ": ${price} ${unit}`);
                        return {
                            price: price.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `بمبلغ ${price} ${unit}`,
                            isDirect: true
                        };
                    }
                    return null;
                }
            }
        ];
        
        // تطبيق كل نمط للبحث عن السعر المباشر
        for (const patternObj of directPricePatterns) {
            let match;
            while ((match = patternObj.pattern.exec(text)) !== null) {
                const priceInfo = patternObj.calculator(match);
                if (priceInfo) {
                    result.price = priceInfo.price;
                    result.priceInfo = priceInfo;
                    console.log('✅ تم استخراج سعر مباشر:', priceInfo);
                    return; // الخروج بعد أول تطابق ناجح
                }
            }
        }
        
        // نمط إضافي: رقم عشري يليه عملة مباشرة (بدون كلمات مفتاحية)
        const genericPricePattern = /(\d+\.\d+)\s*(جنيه|ج|ريال|درهم|دولار)/gi;
        const genericMatch = genericPricePattern.exec(text);
        if (genericMatch) {
            result.price = genericMatch[1];
            result.priceUnit = genericMatch[2];
            console.log('✅ تم استخراج سعر عشري تلقائي:', result.price);
        }
    }
    
    // استخراج التعبيرات المعقدة للسعر
    extractComplexPrice(text, result) {
        console.log('💰 البحث عن تعبيرات سعر معقدة في:', text);
        
        // التعبيرات المعقدة للسعر
        const complexPricePatterns = [
            // "تلاتاشر وتمنتاشر من ميه جنيه" - كسور عشرية دقيقة
            {
                pattern: /(\d+(?:\.\d+)?|\w+)\s+(و|plus|\+)\s+(\d+(?:\.\d+)?|\w+)\s+(من|of|\/|من)\s+(\d+(?:\.\d+)?|\w+)\s*(جنيه|ج|ريال|دولار|ب|جنية)?/gi,
                calculator: (match) => {
                    const num1 = this.parseArabicNumber(match[1]);
                    const num2 = this.parseArabicNumber(match[3]);
                    const total = this.parseArabicNumber(match[5]);
                    const unit = match[6] || 'جنيه';
                    
                    if (num1 && num2 && total) {
                        // إذا كان المجموع يساوي أو يقارب المجموع الكلي، نستخدم السعر المباشر
                        const sum = num1 + num2;
                        
                        // إذا كان المجموع قريباً جداً من المجموع الكلي (خطأ 5 أرقام فقط)، نستخدمه كسعر مباشر
                        if (Math.abs(sum - total) <= 5) {
                            console.log(`💰 وجد سعر مباشر (تقريب دقيق): ${sum} ${unit} (بدلاً من ${total})`);
                            return {
                                price: sum.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${sum} ${unit} (تقريب دقيق من ${total})`,
                                isDirect: true,
                                isApproximation: true
                            };
                        }
                        // إذا كان المجموع أقل من النصف، نحسبه كسر عشري دقيق
                        else if (sum < total / 2) {
                            const calculated = (sum / total) * 100;
                            console.log(`💰 حساب كسر عشري دقيق: ${sum} / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`);
                            return {
                                price: calculated.toFixed(2),
                                totalPrice: total.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${sum} / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`,
                                isFraction: true,
                                numerator: sum.toString(),
                                denominator: total.toString()
                            };
                        }
                        // إذا كان المجموع كبير جداً (أكبر من المجموع الكلي)، نحسبه كسر عشري أيضاً
                        else if (sum > total * 2) {
                            const calculated = (sum / total) * 100;
                            console.log(`💰 حساب كسر عشري (مجموع كبير): ${sum} / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`);
                            return {
                                price: calculated.toFixed(2),
                                totalPrice: total.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${sum} / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`,
                                isFraction: true,
                                numerator: sum.toString(),
                                denominator: total.toString()
                            };
                        }
                        // وإلا نستخدم الجمع العادي
                        else {
                            console.log(`💰 حساب سعر معقد (جمع): ${num1} + ${num2} = ${sum} من ${total} ${unit}`);
                            return {
                                price: sum.toString(),
                                totalPrice: total.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${num1} + ${num2} = ${sum} من ${total} ${unit}`,
                                isFraction: false
                            };
                        }
                    }
                    return null;
                }
            },
            
            // "تلاتاشر وتمنتاشر من ميه جنيه" - نمط خاص للكسور العشرية
            {
                pattern: /(\d+(?:\.\d+)?|\w+)\s+(و|plus|\+)\s+(\d+(?:\.\d+)?|\w+)\s+(من|of|\/|من)\s+(\d+(?:\.\d+)?|\w+)\s*(جنيه|ج|ريال|دولار|ب|جنية)?/gi,
                calculator: (match) => {
                    const num1 = this.parseArabicNumber(match[1]);
                    const num2 = this.parseArabicNumber(match[3]);
                    const total = this.parseArabicNumber(match[5]);
                    const unit = match[6] || 'جنيه';
                    
                    if (num1 && num2 && total) {
                        // التحقق إذا كان هذا نمط كسر عشري (رقم + رقم من رقم كبير)
                        // تم إزالة قيد (num1 < 50) لدعم الأسعار الكبيرة
                        if (num2 < 100 && total >= 100) {
                            // حساب كسر عشري: (num1.num2) كرقم عشري
                            const decimalPrice = parseFloat(`${num1}.${num2.toString().padStart(2, '0')}`);
                            console.log(`💰 حساب كسر عشري مركب: ${num1}.${num2.toString().padStart(2, '0')} ${unit} (من ${total})`);
                            return {
                                price: decimalPrice.toFixed(2),
                                unit: unit,
                                expression: match[0],
                                calculation: `${num1}.${num2.toString().padStart(2, '0')} ${unit} (كسر عشري من ${total})`,
                                isFraction: true,
                                isDecimalFraction: true,
                                numerator: `${num1}.${num2.toString().padStart(2, '0')}`,
                                denominator: total.toString()
                            };
                        }
                        
                        // الحساب العادي
                        const sum = num1 + num2;
                        if (sum < total / 2) {
                            const calculated = (sum / total) * 100;
                            console.log(`💰 حساب كسر عشري: ${sum} / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`);
                            return {
                                price: calculated.toFixed(2),
                                totalPrice: total.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${sum} / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`,
                                isFraction: true,
                                numerator: sum.toString(),
                                denominator: total.toString()
                            };
                        } else {
                            console.log(`💰 حساب سعر معقد (جمع): ${num1} + ${num2} = ${sum} من ${total} ${unit}`);
                            return {
                                price: sum.toString(),
                                totalPrice: total.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${num1} + ${num2} = ${sum} من ${total} ${unit}`,
                                isFraction: false
                            };
                        }
                    }
                    return null;
                }
            },
            
            // "اربعتاشر وتسعتاشر من مية جنية" - سعر مباشر (تقريب)
            {
                pattern: /(\d+(?:\.\d+)?|\w+)\s+(و|plus|\+)\s+(\d+(?:\.\d+)?|\w+)\s+(من|of|\/|من)\s+(\d+(?:\.\d+)?|\w+)\s*(جنيه|ج|ريال|دولار|ب|جنية)?/gi,
                calculator: (match) => {
                    const num1 = this.parseArabicNumber(match[1]);
                    const num2 = this.parseArabicNumber(match[3]);
                    const total = this.parseArabicNumber(match[5]);
                    const unit = match[6] || 'جنيه';
                    
                    if (num1 && num2 && total) {
                        const sum = num1 + num2;
                        
                        // إذا كان المجموع قريباً جداً من المجموع الكلي، نستخدمه كسعر مباشر
                        if (Math.abs(sum - total) <= 5) {
                            console.log(`💰 وجد سعر مباشر (تقريب دقيق): ${sum} ${unit} (بدلاً من ${total})`);
                            return {
                                price: sum.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${sum} ${unit} (تقريب دقيق من ${total})`,
                                isDirect: true,
                                isApproximation: true
                            };
                        }
                        // إذا كان المجموع أقل بكثير، نحسبه كسر عشري
                        else if (sum < total / 2) {
                            const calculated = (sum / total) * 100;
                            console.log(`💰 حساب كسر عشري: ${sum} / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`);
                            return {
                                price: calculated.toFixed(2),
                                totalPrice: total.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${sum} / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`,
                                isFraction: true,
                                numerator: sum.toString(),
                                denominator: total.toString()
                            };
                        }
                        // وإلا نستخدم الجمع العادي
                        else {
                            console.log(`💰 حساب سعر معقد (جمع): ${num1} + ${num2} = ${sum} من ${total} ${unit}`);
                            return {
                                price: sum.toString(),
                                totalPrice: total.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${num1} + ${num2} = ${sum} من ${total} ${unit}`,
                                isFraction: false
                            };
                        }
                    }
                    return null;
                }
            },
            
            // "خمسين ونص من مية" - كسور مختلطة
            {
                pattern: /(\d+|\w+)\s+(و|plus|\+)\s+(نصف|نص|ربع|ثلث|ثمن|خمس|سدس|سبع|ثمن|تسع)\s+(من|of|\/|من)\s+(\d+|\w+)\s*(جنيه|ج|ريال|دولار|ب|جنية)?/gi,
                calculator: (match) => {
                    const num1 = this.parseArabicNumber(match[1]);
                    const fraction = this.parseFraction(match[3]);
                    const total = this.parseArabicNumber(match[5]);
                    const unit = match[6] || 'جنيه';
                    
                    if (num1 && fraction !== null && total) {
                        const numerator = num1 + fraction;
                        
                        // إذا كان الناتج قريباً جداً من المجموع الكلي
                        if (Math.abs(numerator - total) <= 5) {
                            console.log(`💰 وجد سعر مباشر مع كسر (تقريب): ${numerator} ${unit} (بدلاً من ${total})`);
                            return {
                                price: numerator.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `${numerator} ${unit} (تقريب من ${total})`,
                                isDirect: true,
                                isApproximation: true
                            };
                        }
                        // وإلا نحسبه كسر عشري
                        else {
                            const calculated = (numerator / total) * 100;
                            console.log(`💰 حساب كسر مختلط: (${num1} + ${fraction}) / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`);
                            return {
                                price: calculated.toFixed(2),
                                totalPrice: total.toString(),
                                unit: unit,
                                expression: match[0],
                                calculation: `(${num1} + ${fraction}) / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`,
                                isFraction: true,
                                numerator: numerator.toString(),
                                denominator: total.toString()
                            };
                        }
                    }
                    return null;
                }
            },
            
            // "نص وربع من مية" - كسور مركبة
            {
                pattern: /(نصف|نص|ربع|ثلث|ثمن|خمس|سدس|سبع|ثمن|تسع)\s+(و|plus|\+)\s+(نصف|نص|ربع|ثلث|ثمن|خمس|سدس|سبع|ثمن|تسع)\s+(من|of|\/|من)\s+(\d+|\w+)\s*(جنيه|ج|ريال|دولار|ب|جنية)?/gi,
                calculator: (match) => {
                    const fraction1 = this.parseFraction(match[1]);
                    const fraction2 = this.parseFraction(match[3]);
                    const total = this.parseArabicNumber(match[5]);
                    const unit = match[6] || 'جنيه';
                    
                    if (fraction1 !== null && fraction2 !== null && total) {
                        const numerator = fraction1 + fraction2;
                        const calculated = (numerator / total) * 100;
                        
                        console.log(`💰 حساب كسور مركبة: (${fraction1} + ${fraction2}) / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`);
                        return {
                            price: calculated.toFixed(2),
                            totalPrice: total.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `(${fraction1} + ${fraction2}) / ${total} * 100 = ${calculated.toFixed(2)} ${unit}`,
                            isFraction: true,
                            numerator: numerator.toString(),
                            denominator: total.toString()
                        };
                    }
                    return null;
                }
            },
            
            // "خمسين من مية" - كسر بسيط
            {
                calculator: (match) => {
                    const num1 = this.parseArabicNumber(match[1]);
                    const unit1 = match[2];
                    const num2 = this.parseArabicNumber(match[4]);
                    const unit2 = match[5];
                    
                    if (num1 && num2) {
                        const calculated = num1 + num2;
                        const unit = unit1 || unit2 || 'جنيه';
                        console.log(`💰 حساب سعر مجموع: ${num1} ${unit1} + ${num2} ${unit2} = ${calculated} ${unit}`);
                        return {
                            price: calculated.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `${num1} ${unit1} + ${num2} ${unit2} = ${calculated} ${unit}`,
                            isFraction: false
                        };
                    }
                    return null;
                }
            },
            
            // "خمسة وعشرون جنيه" - جمع مركب
            {
                pattern: /(\d+|\w+)\s+(و|plus|\+)\s+(\d+|\w+)\s*(جنيه|ج|ريال|دولار|ب|جنية)/gi,
                calculator: (match) => {
                    const num1 = this.parseArabicNumber(match[1]);
                    const num2 = this.parseArabicNumber(match[3]);
                    const unit = match[4] || 'جنيه';
                    
                    if (num1 && num2) {
                        const calculated = num1 + num2;
                        console.log(`💰 حساب سعر مركب: ${num1} + ${num2} = ${calculated} ${unit}`);
                        return {
                            price: calculated.toString(),
                            unit: unit,
                            expression: match[0],
                            calculation: `${num1} + ${num2} = ${calculated} ${unit}`,
                            isFraction: false
                        };
                    }
                    return null;
                }
            },
            
            // "نص جنيه" - كسور بسيطة
            {
                pattern: /(نصف|نص|ربع|ثلث|ثمن|خمس|سدس|سبع|ثمن|تسع)\s*(جنيه|ج|ريال|دولار|ب|جنية)?/gi,
                calculator: (match) => {
                    const fraction = match[1];
                    const unit = match[2] || 'جنيه';
                    
                    const calculated = this.parseFraction(fraction);
                    
                    console.log(`💰 حساب كسر بسيط: ${fraction} ${unit} = ${calculated} ${unit}`);
                    return {
                        price: calculated.toString(),
                        unit: unit,
                        expression: match[0],
                        calculation: `${fraction} ${unit} = ${calculated} ${unit}`,
                        isFraction: true
                    };
                }
            }
        ];
        
        // تطبيق كل نمط للبحث عن السعر
        for (const patternObj of complexPricePatterns) {
            let match;
            while ((match = patternObj.pattern.exec(text)) !== null) {
                const priceInfo = patternObj.calculator(match);
                if (priceInfo) {
                    result.price = priceInfo.price;
                    result.priceInfo = priceInfo;
                    console.log('✅ تم استخراج سعر معقد:', priceInfo);
                    return; // الخروج بعد أول تطابق ناجح
                }
            }
        }
    }
    
    // تحويل الكسور العربية إلى أرقام
    parseFraction(fraction) {
        const fractions = {
            'نصف': 0.5,
            'نص': 0.5,
            'ربع': 0.25,
            'ثلث': 0.33,
            'ثمن': 0.125,
            'خمس': 0.2,
            'سدس': 0.166,
            'سبع': 0.143,
            'ثمن': 0.125,
            'تسع': 0.111
        };
        
        return fractions[fraction.toLowerCase()] || null;
    }
    
    // تحويل الأرقام العربية إلى أرقام (يدعم الجمع الديناميكي: "مية وحداشر")
    parseArabicNumber(text) {
        if (!text) return null;
        
        // إذا كان رقم عادي (صحيح أو عشري)
        if (/^\d+(?:\.\d+)?$/.test(text)) {
            return parseFloat(text);
        }
        
        // البحث في قاموس الأرقام
        const cleanText = text.toLowerCase().trim();
        
        // الأرقام المركبة أولاً
        if (this.arabicNumberConverter.complexNumbers[cleanText]) {
            return this.arabicNumberConverter.complexNumbers[cleanText];
        }
        
        // الأرقام الأساسية
        if (this.arabicNumberConverter.basicNumbers[cleanText]) {
            return this.arabicNumberConverter.basicNumbers[cleanText];
        }

        // منطق الجمع الديناميكي: "مية وحداشر" أو "خمسة وعشرين"
        // نبحث عن حرف العطف "و" (سواء بمسافة أو ملتصق بالكلمة)
        if (cleanText.includes(' و') || cleanText.includes('و')) {
            // تقسيم النص بشرط أن يكون "و" حرف عطف وليس جزءاً من كلمة
            // نستخدم regex للتقسيم حول " و " أو " و" في بداية الكلمة التالية
            const parts = cleanText.split(/\s*و\s*|\s+و/);
            let sum = 0;
            let success = false;
            
            for (let part of parts) {
                if (!part) continue;
                
                // محاولة تحويل الجزء (recursive call)
                const val = this.parseArabicNumber(part);
                if (val !== null) {
                    sum += val;
                    success = true;
                }
            }
            
            if (success && sum > 0) return sum;
        }
        
        return null;
    }
    
    extractProductAndQuantity(text, result) {
        const words = text.split(/\s+/);
        let productName = '';
        let lastNumber = null;
        let detectedProducts = [];
        
        console.log('🔍 تحليل النص المحول:', text);
        console.log('🔍 الكلمات:', words);
        
        // أولاً: البحث عن المنتجات في قاعدة البيانات
        for (let i = 0; i < words.length; i++) {
            const word = words[i].toLowerCase().trim();
            
            // البحث في قاعدة بيانات المنتجات
            if (this.arabicNumberConverter.productDatabase[word]) {
                const product = this.arabicNumberConverter.productDatabase[word];
                detectedProducts.push({
                    original: words[i],
                    name: product,
                    position: i
                });
                console.log(`📦 وجد منتج في قاعدة البيانات: "${words[i]}" → "${product}"`);
            }
            // البحث بالكلمات المفتاحية
            else if (this.arabicNumberConverter.isProductKeyword(word)) {
                detectedProducts.push({
                    original: words[i],
                    name: words[i],
                    position: i
                });
                console.log(`🔍 وجد منتج بالكلمة المفتاحية: "${words[i]}"`);
            }
        }
        
        // ثانياً: تحليل الكلمات مع الأرقام
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const nextWord = words[i + 1];
            const prevWord = words[i - 1];
            
            // تجاهل الكلمات المفتاحية للسعر والكمية والخصم
            const priceKeywords = ['سعر', 'جنيه', 'ج', 'ريال', 'دولار', 'ب'];
            const quantityKeywords = ['كمية', 'عدد', 'قطعة', 'قطع', 'صندوق', 'صناديق', 'كرتونة', 'كراتين'];
            const discountKeywords = ['خصم', 'تخفيض', 'نسبة', 'في المئة'];
            
            console.log(`🔍 تحليل الكلمة: "${word}"`);
            
            if (priceKeywords.includes(word) || quantityKeywords.includes(word) || discountKeywords.includes(word)) {
                console.log(`⏭️ تجاهل كلمة مفتاحية: "${word}"`);
                continue;
            }
            
            // إذا كانت الكلمة الحالية رقم (صحيح أو عشري)
            if (/^\d+(?:\.\d+)?$/.test(word)) {
                lastNumber = parseFloat(word);
                console.log(`🔢 وجد رقم: ${lastNumber}`);
                
                // ذكاء إضافي: إذا كان الرقم عشرياً (يحتوي على نقطة)، فهو على الأغلب سعر وليس كمية
                if (word.includes('.') && !result.price) {
                    result.price = word;
                    console.log(`✅ تم تعيين السعر تلقائياً (رقم عشري): ${word}`);
                }
                
                // ذكاء إضافي للخصم: إذا سبق الرقم كلمة "خصم"
                if (prevWord && discountKeywords.includes(prevWord.toLowerCase())) {
                    result.discount = lastNumber.toString();
                    console.log(`✅ تم تعيين الخصم تلقائياً: ${result.discount}`);
                }
                
                // إذا كانت الكلمة التالية اسم منتج (من قاعدة البيانات)
                if (nextWord && this.arabicNumberConverter.productDatabase[nextWord.toLowerCase()]) {
                    if (!result.quantity && !word.includes('.')) {
                        result.quantity = lastNumber;
                        console.log(`✅ تم تعيين الكمية: ${lastNumber} (رقم قبل منتج معروف)`);
                    }
                }
                // إذا كانت الكلمة التالية اسم منتج عادي
                else if (nextWord && !/^\d+(?:\.\d+)?$/.test(nextWord) && 
                    !priceKeywords.includes(nextWord) && 
                    !quantityKeywords.includes(nextWord) &&
                    !discountKeywords.includes(nextWord)) {
                    if (!result.quantity && !word.includes('.')) {
                        result.quantity = lastNumber;
                        console.log(`✅ تم تعيين الكمية: ${lastNumber} (رقم قبل منتج)`);
                    }
                }
            }
            // إذا كانت الكلمة الحالية اسم منتج والسابقة رقم
            else if (lastNumber !== null && 
                    !priceKeywords.includes(word) && 
                    !quantityKeywords.includes(word) &&
                    !discountKeywords.includes(word) &&
                    !/^\d+(?:\.\d+)?$/.test(word)) {
                
                console.log(`📦 وجد اسم منتج: "${word}" بعد رقم: ${lastNumber}`);
                
                // التحقق إذا كان المنتج موجود في قاعدة البيانات
                const productInDB = this.arabicNumberConverter.productDatabase[word.toLowerCase()];
                
                if (!result.productName) {
                    productName = productInDB || word;
                    if (!result.quantity) {
                        result.quantity = lastNumber;
                        console.log(`✅ تم تعيين الكمية: ${lastNumber} (رقم قبل اسم المنتج)`);
                    }
                    console.log(`📦 تم تحديد اسم المنتج: "${productName}"`);
                }
                
                lastNumber = null;
            }
            // إذا كانت الكلمة اسم منتج أو محتملة كمنتج
            else if (!/^\d+(?:\.\d+)?$/.test(word) && 
                    !priceKeywords.includes(word) && 
                    !quantityKeywords.includes(word) &&
                    !discountKeywords.includes(word)) {
                
                console.log(`📦 معالجة كلمة منتج: "${word}"`);
                
                // التحقق إذا كان المنتج موجود في قاعدة البيانات
                const productInDB = this.arabicNumberConverter.productDatabase[word.toLowerCase()];
                const finalWord = productInDB || word;
                
                if (!productName) {
                    productName = finalWord;
                    console.log(`📦 تم تحديد بداية اسم المنتج: "${productName}"`);
                } else {
                    // تجميع الأسماء المركبة (مثل: بانادول اكسترا)
                    // نتوقف عن التجميع إذا وجدنا رقماً أو كلمة مفتاحية للسعر/الكمية
                    productName += ' ' + finalWord;
                    console.log(`📦 تحديث اسم المنتج المركب: "${productName}"`);
                }
            }
        }
        
        // تنظيف اسم المنتج من الكلمات الزائدة في النهاية (مثل "و")
        productName = productName.replace(/\s+و$/, '').trim();
        
        // ثالثاً: استخدام المنتجات المكتشفة من قاعدة البيانات
        if (detectedProducts.length > 0 && !productName) {
            // أخذ أول منتج تم اكتشافه
            const firstProduct = detectedProducts[0];
            productName = firstProduct.name;
            console.log(`📦 استخدام المنتج المكتشف من قاعدة البيانات: "${productName}"`);
            
            // إذا كان هناك رقم قبل المنتج، اجعله الكمية
            const productIndex = firstProduct.position;
            if (productIndex > 0) {
                const prevWord = words[productIndex - 1];
                if (/^\d+(?:\.\d+)?$/.test(prevWord)) {
                    result.quantity = parseFloat(prevWord);
                    console.log(`✅ تم تعيين الكمية من قبل المنتج: ${result.quantity}`);
                }
            }
        }
        
        result.productName = productName.trim();
        
        // إضافة معلومات المنتج المكتشف
        if (detectedProducts.length > 0) {
            result.detectedProductInfo = {
                count: detectedProducts.length,
                products: detectedProducts,
                primary: detectedProducts[0]
            };
        }
        
        console.log('🎯 النتيجة النهائية:', result);
    }
    
    fillFields(data) {
        if (!this.productNameInput || !this.priceInput || !this.quantityInput || !this.discountInput) return;
        
        console.log('🔄 ملء الحقول بالبيانات:', data);
        
        // 1. ملء اسم المنتج بمراعاة عدم مسح اسم أُدخل مسبقاً لصالح كلمات عشوائية
        if (data.productName && data.productName.trim() !== '') {
            const currentVal = this.productNameInput.value.trim();
            const isEnglishMedicineName = /^[A-Za-z]/.test(data.productName) && data.productName.toLowerCase().includes('tablet') || data.productName.toLowerCase().includes('capsule') || data.productName.toLowerCase().includes('injection') || data.productName.toLowerCase().includes('syrup') || data.productName.toLowerCase().includes('cream') || data.productName.toLowerCase().includes('ointment') || data.productName.toLowerCase().includes('solution') || data.productName.toLowerCase().includes('spray') || data.productName.toLowerCase().includes('drops') || data.productName.toLowerCase().includes('gel') || data.productName.toLowerCase().includes('powder') || data.productName.toLowerCase().includes('suspension') || data.productName.toLowerCase().includes('elixir');
            
            if (currentVal !== '') {
                // إذا كان الحقل ممتلئاً سلفاً، نقبل القيمة إذا كانت اسم دواء بالإنجليزية أو منتجاً معروفاً
                if (isEnglishMedicineName) {
                    this.productNameInput.value = data.productName;
                    console.log('✅ تم تحديث اسم المنتج باسم دواء بالإنجليزية:', data.productName);
                } else {
                    console.log('⚠️ تم حظر تجاوز اسم المنتج: الكلمة (' + data.productName + ') تعتبر عشوائية أو غير مسجلة وتم تجاهلها لحماية اسم المنتج الحالي.');
                }
            } else {
                // إذا كان الحقل فارغاً، نقبل أي بيانات مستخرجة أو محتملة
                this.productNameInput.value = data.productName;
                console.log('✅ تم ملء اسم المنتج:', data.productName);
            }
        }
        
        // 2. ملء السعر
        if (data.price) {
            const priceValue = parseFloat(data.price);
            if (!isNaN(priceValue)) {
                const formattedPrice = priceValue.toFixed(2);
                if (this.priceInput) {
                    this.priceInput.value = formattedPrice;
                }
                const [priceInt, priceFrac] = formattedPrice.split('.');
                if (this.priceIntInput) {
                    this.priceIntInput.value = priceInt;
                }
                if (this.priceFracInput) {
                    this.priceFracInput.value = priceFrac;
                }
                console.log('✅ تم ملء السعر:', formattedPrice);
            }
        }
        
        // 2.1 ملء الرقم الصحيح للسعر بشكل منفصل
        if (data.priceInt) {
            if (this.priceIntInput) {
                this.priceIntInput.value = data.priceInt;
                console.log('✅ تم ملء الرقم الصحيح للسعر:', data.priceInt);
            }
        }
        
        // 2.2 ملء الجزء العشري للسعر بشكل منفصل
        if (data.priceFrac) {
            if (this.priceFracInput) {
                this.priceFracInput.value = data.priceFrac;
                console.log('✅ تم ملء الجزء العشري للسعر:', data.priceFrac);
            }
        }
        
        // 3. ملء الكمية
        if (data.quantity) {
            this.quantityInput.value = data.quantity;
            console.log('✅ تم ملء الكمية:', data.quantity);
        }
        
        // 4. ملء الخصم
        if (data.discount) {
            this.discountInput.value = data.discount;
            console.log('✅ تم ملء الخصم:', data.discount);
        }
        
        // 5. ملء تواريخ الإنتاج والانتهاء
        if (data.prodDate) {
            const pd = document.getElementById('prodDay');
            const pm = document.getElementById('prodMonth');
            const py = document.getElementById('prodYear');
            if (pd && pm && py) {
                pd.value = data.prodDate.day;
                pm.value = data.prodDate.month;
                py.value = data.prodDate.year;
                console.log('✅ تم ملء تاريخ الإنتاج:', data.prodDate);
            }
        }
        if (data.prodDay) {
            const pd = document.getElementById('prodDay');
            if (pd) {
                pd.value = data.prodDay;
                console.log('✅ تم ملء يوم الإنتاج:', data.prodDay);
            }
        }
        if (data.prodMonth) {
            const pm = document.getElementById('prodMonth');
            if (pm) {
                pm.value = data.prodMonth;
                console.log('✅ تم ملء شهر الإنتاج:', data.prodMonth);
            }
        }
        if (data.prodYear) {
            const py = document.getElementById('prodYear');
            if (py) {
                py.value = data.prodYear;
                console.log('✅ تم ملء سنة الإنتاج:', data.prodYear);
            }
        }
        if (data.expDate) {
            const ed = document.getElementById('expDay');
            const em = document.getElementById('expMonth');
            const ey = document.getElementById('expYear');
            if (ed && em && ey) {
                ed.value = data.expDate.day;
                em.value = data.expDate.month;
                ey.value = data.expDate.year;
                console.log('✅ تم ملء تاريخ الانتهاء:', data.expDate);
            }
        }
        if (data.expDay) {
            const ed = document.getElementById('expDay');
            if (ed) {
                ed.value = data.expDay;
                console.log('✅ تم ملء يوم الانتهاء:', data.expDay);
            }
        }
        if (data.expMonth) {
            const em = document.getElementById('expMonth');
            if (em) {
                em.value = data.expMonth;
                console.log('✅ تم ملء شهر الانتهاء:', data.expMonth);
            }
        }
        if (data.expYear) {
            const ey = document.getElementById('expYear');
            if (ey) {
                ey.value = data.expYear;
                console.log('✅ تم ملء سنة الانتهاء:', data.expYear);
            }
        }
        
        // تحديث حالة الزر
        if (typeof checkFormValidity === 'function') {
            checkFormValidity();
        }
        
        // دمج السعر وتحديث الحقل المخفي
        if (typeof syncCombinedPrice === 'function') {
            syncCombinedPrice();
        }
    }
    
    confirmEnteredData(data) {
        console.log('🛑 تم تعطيل تأكيد البيانات الصوتي:', data);
    }
    
    enableAutoRepeat() {
        if (!this.autoRepeatEnabled) return; // توقف فوراً إذا قام المستخدم بالإيقاف اليدوي
        if (!this.productNameInput || !this.quantityInput || !this.priceInput) return;
        
        const hasProduct = this.productNameInput.value.trim() !== '';
        const hasQuantity = this.quantityInput.value.trim() !== '';
        const hasPrice = this.priceInput.value.trim() !== '';
        
        if (!hasProduct || !hasQuantity || !hasPrice) {
            console.log('🔄 تفعيل الاستماع التلقائي...');
            
            const checkSpeakingAndStart = () => {
                // منع تشغيل الميكروفون إذا كان المساعد الصوتي يتحدث حتى لا يسمع نفسه ويعيد الإدخال بالخطأ
                if (window.speechSynthesis && window.speechSynthesis.speaking) {
                    setTimeout(checkSpeakingAndStart, 500);
                } else {
                    if (!this.isListening) {
                        console.log('🎤 بدء الاستماع التلقائي...');
                        this.startListening();
                        this.showTemporaryMessage('🎤 الاستماع التلقائي مفعّل... قل البيانات التالية', 2000);
                    }
                }
            };
            
            // نبدأ التحقق بعد 200 مللي ثانية للسماح لجملة التأكيد الصوتي بالبدء أولاً
            setTimeout(checkSpeakingAndStart, 200);
        } else {
            console.log('✅ جميع الحقول ممتلئة، إيقاف الاستماع التلقائي');
            this.showTemporaryMessage('✅ اكتمل إدخال البيانات الأساسية', 2000);
        }
    }
    
    disableAutoRepeat() {
        this.autoRepeatEnabled = false;
        console.log('🛑 إيقاف الاستماع التلقائي');
        this.showTemporaryMessage('🛑 تم إيقاف الاستماع التلقائي', 2000);
    }
    
    showResult(data) {
        let message = '🎤 تم استخراج البيانات:\n\n';
        
        if (data.productName) message += `📦 المنتج: ${data.productName}\n`;
        if (data.price) message += `💰 السعر: ${data.price}\n`;
        if (data.quantity) message += `📊 الكمية: ${data.quantity}\n`;
        if (data.discount) message += `📉 الخصم: ${data.discount}%\n`;
        
        this.showTemporaryMessage(message, 3000);
    }
    
    showTemporaryMessage(message, duration = 3000) {
        // إنشاء أو تحديث رسالة مؤقتة
        let messageDiv = document.getElementById('voiceMessage');
        if (!messageDiv) {
            messageDiv = document.createElement('div');
            messageDiv.id = 'voiceMessage';
            messageDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 20px;
                border-radius: 10px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                z-index: 10000;
                font-size: 14px;
                max-width: 300px;
                white-space: pre-line;
                animation: slideIn 0.3s ease-out;
            `;
            document.body.appendChild(messageDiv);
        }
        
        messageDiv.textContent = message;
        
        // إخفاء الرسالة بعد المدة المحددة
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, duration);
    }
    
    handleError(error) {
        let errorMessage = '❌ حدث خطأ في الإدخال الصوتي\n\n';
        
        switch(error) {
            case 'no-speech':
                errorMessage += 'لم يتم اكتشاف أي كلام. يرجى المحاولة مرة أخرى.';
                break;
            case 'audio-capture':
                errorMessage += 'لا يمكن الوصول إلى الميكروفون. يرجى التحقق من الإعدادات.';
                break;
            case 'not-allowed':
                errorMessage += 'تم رفض الإذن للوصول إلى الميكروفون.';
                break;
            case 'network':
                errorMessage += 'مشكلة في الاتصال بالشبكة.';
                break;
            default:
                errorMessage += `خطأ غير معروف: ${error}`;
        }
        
        this.showTemporaryMessage(errorMessage, 4000);
    }
}

// تهيئة النظام عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 تهيئة نظام الإدخال الصوتي v10.1 مع خصخصية المخازن...');
    
    // التحقق من وجود أزرار ميكروفون لأي حقل أو زر الإدخال الصوتي العام
    if (document.getElementById('voiceInputBtn') || document.querySelector('.field-mic-btn')) {
        window.voiceProcessor = new VoiceInputProcessor();
        console.log('✅ نظام الإدخال الصوتي جاهز للاستخدام');
        
        // تهيئة نظام خصخصية المخازن
        window.warehouseSystem = new WarehouseSystem();
        console.log('✅ نظام خصخصية المخازن جاهز للاستخدام');
    } else {
        console.warn('⚠️ لم يتم العثور على أي عناصر إدخال صوتي');
    }
});

// نظام خصخصية المخازن الشامل
class WarehouseSystem {
    constructor() {
        this.currentUser = null;
        this.currentWarehouseId = null;
        this.supabase = window.supabaseClient;
        
        // تهيئة النظام
        this.initializeSystem();
    }
    
    // تهيئة النظام
    async initializeSystem() {
        try {
            console.log('🏭 تهيئة نظام خصخصية المخازن...');
            
            // الحصول على المستخدم الحالي مع معالجة الأخطاء
            try {
                await this.getCurrentUser();
            } catch (userError) {
                console.warn('⚠️ لا يمكن الحصول على المستخدم، استخدام Auth Guard:', userError);
                // استخدام Auth Guard إذا فشل الحصول على المستخدم
                try {
                    if (window.authGuard && window.authGuard.getCurrentUser) {
                        const authUser = window.authGuard.getCurrentUser();
                        if (authUser && authUser.user) {
                            this.currentUser = authUser.user;
                            this.currentWarehouseId = authUser.warehouseId;
                        }
                    }
                } catch (authGuardError) {
                    console.error('❌ خطأ في استخدام Auth Guard:', authGuardError);
                }
            }
            
            // ربط الأحداث
            try {
                this.setupEventListeners();
            } catch (eventError) {
                console.error('❌ خطأ في ربط الأحداث:', eventError);
            }
            
            console.log('✅ نظام خصخصية المخازن جاهز');
        } catch (error) {
            console.error('❌ خطأ في تهيئة نظام المخازن:', error);
        }
    }
    
    // الحصول على المستخدم الحالي مع معالجة أفضل للأخطاء
    async getCurrentUser() {
        try {
            // التحقق أولاً من وجود جلسة
            if (!this.supabase) {
                console.warn('⚠️ Supabase غير مهيأ');
                return null;
            }
            
            const { data: { user }, error } = await this.supabase.auth.getUser();
            
            if (error) {
                if (error.message.includes('AuthSessionMissing')) {
                    console.warn('⚠️ لا توجد جلسة نشطة');
                    return null;
                } else {
                    console.error('❌ خطأ في الحصول على المستخدم:', error);
                    throw error;
                }
            }
            
            this.currentUser = user;
            this.currentWarehouseId = user?.user_metadata?.warehouse_id || user?.id;
            
            console.log('👤 المستخدم الحالي:', {
                id: user?.id,
                email: user?.email,
                warehouse_id: this.currentWarehouseId
            });
            
            return user;
        } catch (error) {
            console.error('❌ خطأ في الحصول على جلسة المستخدم:', error);
            return null;
        }
    }
    
    // ربط الأحداث
    setupEventListeners() {
        // ربط مع نموذج إضافة المنتج
        const productForm = document.getElementById('productForm');
        if (productForm) {
            // تعديل دالة handleSubmit لإضافة warehouse_id
            const originalSubmit = window.handleSubmit;
            window.handleSubmit = async (e) => {
                e.preventDefault();
                
                const productData = {
                    productName: document.getElementById('productName').value,
                    price: parseFloat(document.getElementById('price').value),
                    discount: parseFloat(document.getElementById('discount').value) || 0,
                    quantity: parseInt(document.getElementById('quantity').value),
                    productionDate: this.getSplitDate('prod'),
                    expiryDate: this.getSplitDate('exp'),
                    addedDate: new Date().toISOString(),
                    warehouse_id: this.currentWarehouseId // إضافة هوية المخزن
                };
                
                console.log('📦 بيانات المنتج مع warehouse_id:', productData);
                
                // حفظ في Supabase مع التحقق من الخصوصية
                await this.saveToSupabaseWithOwnership(productData);
                
                // حفظ في localStorage كنسخة احتياطية
                const products = JSON.parse(localStorage.getItem('products')) || [];
                productData.id = Date.now();
                products.push(productData);
                localStorage.setItem('products', JSON.stringify(products));
                
                // عرض رسالة نجاح
                this.showCustomAlert('تم إضافة المنتج بنجاح!', 'success');
                
                // إعادة تعيين النموذج
                productForm.reset();
                if (typeof checkFormValidity === 'function') {
                    checkFormValidity();
                }
            };
        }
    }
    
    // حفظ في Supabase مع التحقق من الملكية
    async saveToSupabaseWithOwnership(productData) {
        try {
            console.log('💾 حفظ المنتج مع التحقق من الملكية...');
            
            const { data, error } = await this.supabase
                .from('products')
                .insert([productData])
                .select();
            
            if (error) {
                console.error('❌ خطأ في حفظ البيانات:', error);
                this.showCustomAlert('فشل حفظ البيانات في السيرفر', 'error');
            } else {
                console.log('✅ تم الحفظ بنجاح في Supabase:', data);
            }
        } catch (error) {
            console.error('❌ خطأ في الاتصال بـ Supabase:', error);
            this.showCustomAlert('خطأ في الاتصال بالسيرفر', 'error');
        }
    }
    
    // جلب المنتجات مع فلترة الخصوصية
    async fetchProducts() {
        try {
            console.log('📋 جلب المنتجات مع فلترة الخصوصية...');
            
            if (!this.currentWarehouseId) {
                console.warn('⚠️ لا يوجد warehouse_id، جلب جميع المنتجات');
                const { data, error } = await this.supabase
                    .from('products')
                    .select('*')
                    .order('addedDate', { ascending: false });
                
                return { data, error };
            }
            
            // جلب المنتجات الخاصة بالمخزن الحالي فقط
            const { data, error } = await this.supabase
                .from('products')
                .select('*')
                .eq('warehouse_id', this.currentWarehouseId)
                .order('addedDate', { ascending: false });
            
            if (error) {
                console.error('❌ خطأ في جلب المنتجات:', error);
            } else {
                console.log(`✅ تم جلب ${data?.length || 0} منتج للمخزن ${this.currentWarehouseId}`);
            }
            
            return { data, error };
        } catch (error) {
            console.error('❌ خطأ في جلب المنتجات:', error);
            return { data: null, error };
        }
    }
    
    // حذف منتج فردي مع التحقق من الملكية
    async deleteProduct(productId) {
        try {
            console.log('🗑️ حذف منتج مع التحقق من الملكية:', productId);
            
            if (!this.currentWarehouseId) {
                this.showCustomAlert('لا يمكن حذف المنتج: لم يتم تحديد المخزن', 'error');
                return false;
            }
            
            // التحقق من ملكية المنتج أولاً
            const { data: product, error: fetchError } = await this.supabase
                .from('products')
                .select('warehouse_id')
                .eq('id', productId)
                .single();
            
            if (fetchError) {
                console.error('❌ خطأ في التحقق من ملكية المنتج:', fetchError);
                this.showCustomAlert('فشل التحقق من ملكية المنتج', 'error');
                return false;
            }
            
            if (product.warehouse_id !== this.currentWarehouseId) {
                console.warn('⚠️ محاولة حذف منتج لا يملكه المستخدم');
                this.showCustomAlert('لا يمكنك حذف هذا المنتج: لا تملك صلاحية', 'error');
                return false;
            }
            
            // حذف المنتج بعد التحقق
            const { error: deleteError } = await this.supabase
                .from('products')
                .delete()
                .eq('id', productId);
            
            if (deleteError) {
                console.error('❌ خطأ في حذف المنتج:', deleteError);
                this.showCustomAlert('فشل حذف المنتج', 'error');
                return false;
            }
            
            console.log('✅ تم حذف المنتج بنجاح');
            this.showCustomAlert('تم حذف المنتج بنجاح', 'success');
            return true;
        } catch (error) {
            console.error('❌ خطأ في حذف المنتج:', error);
            this.showCustomAlert('خطأ في حذف المنتج', 'error');
            return false;
        }
    }
    
    // حذف جماعي مع التحقق من الملكية
    async bulkDelete(productIds) {
        try {
            console.log('🗑️ حذف جماعي مع التحقق من الملكية:', productIds);
            
            if (!this.currentWarehouseId) {
                this.showCustomAlert('لا يمكن حذف المنتجات: لم يتم تحديد المخزن', 'error');
                return false;
            }
            
            // التحقق من ملكية جميع المنتجات أولاً
            const { data: products, error: fetchError } = await this.supabase
                .from('products')
                .select('id, warehouse_id')
                .in('id', productIds);
            
            if (fetchError) {
                console.error('❌ خطأ في التحقق من ملكية المنتجات:', fetchError);
                this.showCustomAlert('فشل التحقق من ملكية المنتجات', 'error');
                return false;
            }
            
            // التحقق من أن جميع المنتجات تابعة للمخزن الحالي
            const unownedProducts = products.filter(p => p.warehouse_id !== this.currentWarehouseId);
            if (unownedProducts.length > 0) {
                console.warn('⚠️ محاولة حذف منتجات لا يملكها المستخدم:', unownedProducts);
                this.showCustomAlert('لا يمكنك حذف بعض المنتجات: لا تملك صلاحية', 'error');
                return false;
            }
            
            // حذف المنتجات بعد التحقق
            const { error: deleteError } = await this.supabase
                .from('products')
                .delete()
                .in('id', productIds);
            
            if (deleteError) {
                console.error('❌ خطأ في الحذف الجماعي:', deleteError);
                this.showCustomAlert('فشل حذف المنتجات', 'error');
                return false;
            }
            
            console.log('✅ تم الحذف الجماعي بنجاح');
            this.showCustomAlert(`تم حذف ${productIds.length} منتج بنجاح`, 'success');
            return true;
        } catch (error) {
            console.error('❌ خطأ في الحذف الجماعي:', error);
            this.showCustomAlert('خطأ في حذف المنتجات', 'error');
            return false;
        }
    }
    
    // إدخال جماعي مع ضمان هوية المخزن
    async bulkUpload(productsData) {
        try {
            console.log('📤 إدخال جماعي مع ضمان هوية المخزن:', productsData.length, 'منتج');
            
            if (!this.currentWarehouseId) {
                this.showCustomAlert('لا يمكن إضافة المنتجات: لم يتم تحديد المخزن', 'error');
                return false;
            }
            
            // إضافة warehouse_id إلى كل منتج
            const enrichedProducts = productsData.map(product => ({
                ...product,
                warehouse_id: this.currentWarehouseId,
                addedDate: new Date().toISOString()
            }));
            
            console.log('📦 المنتجات بعد إضافة هوية المخزن:', enrichedProducts);
            
            // إدخال المنتجات في Supabase
            const { data, error } = await this.supabase
                .from('products')
                .insert(enrichedProducts)
                .select();
            
            if (error) {
                console.error('❌ خطأ في الإدخال الجماعي:', error);
                this.showCustomAlert('فشل إضافة المنتجات', 'error');
                return false;
            }
            
            console.log('✅ تم الإدخال الجماعي بنجاح:', data);
            this.showCustomAlert(`تم إضافة ${data.length} منتج بنجاح`, 'success');
            return data;
        } catch (error) {
            console.error('❌ خطأ في الإدخال الجماعي:', error);
            this.showCustomAlert('خطأ في إضافة المنتجات', 'error');
            return false;
        }
    }
    
    // الحصول على التاريخ المقسم
    getSplitDate(prefix) {
        const day = document.getElementById(prefix + 'Day')?.value || '01';
        const month = document.getElementById(prefix + 'Month')?.value || '01';
        const year = document.getElementById(prefix + 'Year')?.value || '2024';
        return `${year}-${month}-${day}`;
    }
    
    // عرض رسائل مخصصة
    showCustomAlert(message, type = 'info') {
        // إنشاء أو تحديث رسالة مخصصة
        let alertDiv = document.getElementById('warehouseAlert');
        if (!alertDiv) {
            alertDiv = document.createElement('div');
            alertDiv.id = 'warehouseAlert';
            alertDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                z-index: 10001;
                max-width: 400px;
                text-align: center;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            `;
            document.body.appendChild(alertDiv);
        }
        
        // تحديد الألوان حسب النوع
        const colors = {
            success: '#28a745',
            error: '#dc3545',
            info: '#007bff',
            warning: '#ffc107'
        };
        
        alertDiv.innerHTML = `
            <div style="color: ${colors[type]}; font-size: 18px; margin-bottom: 15px;">
                ${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'} ${message}
            </div>
            <button onclick="this.parentElement.remove()" style="
                background: ${colors[type]};
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 14px;
            ">حسناً</button>
        `;
        
        // إخفاء الرسالة تلقائياً بعد 5 ثواني
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.parentNode.removeChild(alertDiv);
            }
        }, 5000);
    }

    // تصحيح اسم الدواء باستخدام قائمة أدوية معروفة
    correctMedicineName(name) {
        const medicineNames = [
            'Paracetamol', 'Ibuprofen', 'Aspirin', 'Amoxicillin', 'Metformin',
            'Lisinopril', 'Atorvastatin', 'Omeprazole', 'Albuterol', 'Prednisone',
            'Metoprolol', 'Simvastatin', 'Losartan', 'Gabapentin', 'Sertraline',
            'Levothyroxine', 'Warfarin', 'Citalopram', 'Furosemide', 'Hydrochlorothiazide',
            'Amlodipine', 'Hydrocodone', 'Tramadol', 'Pantoprazole', 'Doxycycline',
            'Azithromycin', 'Ciprofloxacin', 'Clindamycin', 'Diazepam', 'Oxycodone',
            'Morphine', 'Codeine', 'Acetaminophen', 'Diclofenac', 'Naproxen',
            'Celecoxib', 'Etanercept', 'Infliximab', 'Adalimumab', 'Certolizumab',
            'Rituximab', 'Abatacept', 'Tocilizumab', 'Anakinra', 'Canakinumab',
            'Colchicine', 'Probenecid', 'Allopurinol', 'Febuxostat', 'Benzbromarone',
            'Probenecid', 'Sulfasalazine', 'Mesalamine', 'Balsalazide', 'Olsalazine',
            'Dapsone', 'Sulfapyridine', 'Sulfamethoxazole', 'Trimethoprim', 'Pyrazinamide',
            'Ethambutol', 'Isoniazid', 'Rifampin', 'Rifabutin', 'Rifapentine',
            'Bedaquiline', 'Delamanid', 'Linezolid', 'Clofazimine', 'Cycloserine',
            'Terizidone', 'Streptomycin', 'Amikacin', 'Kanamycin', 'Capreomycin',
            'Viagra', 'Cialis', 'Levitra', 'Stendra', 'Staxyn', 'Spedra',
            'Adderall', 'Ritalin', 'Concerta', 'Vyvanse', 'Focalin', 'Strattera',
            'Intuniv', 'Kapvay', 'Tenex', 'Catapres', 'Aldomet', 'Methyldopa',
            'Clonidine', 'Guanfacine', 'Reserpine', 'Minoxidil', 'Diazoxide',
            'Hydralazine', 'Isosorbide', 'Nitroglycerin', 'Amyl nitrite', 'Nitroprusside',
            'Epoprostenol', 'Treprostinil', 'Iloprost', 'Beraprost', 'Selexipag',
            'Macitentan', 'Bosentan', 'Ambrisentan', 'Sitaxsentan', 'Sildenafil',
            'Tadalafil', 'Vardenafil', 'Avanafil', 'Phentolamine', 'Yohimbine',
            'Apomorphine', 'Cabergoline', 'Pramipexole', 'Ropinirole', 'Rotigotine',
            'Piribedil', 'Bromocriptine', 'Pergolide', 'Lisuride', 'Carbidopa',
            'Entacapone', 'Tolcapone', 'Safinamide', 'Opicapone', 'Monoamine',
            'Selegiline', 'Rasagiline', 'Safinamide', 'Amantadine', 'Memantine',
            'Donepezil', 'Galantamine', 'Rivastigmine', 'Tacrine', 'Huperzine',
            'Propentofylline', 'Nicergoline', 'Xanomeline', 'Citicoline', 'Piracetam',
            'Oxiracetam', 'Pramiracetam', 'Aniracetam', 'Fasoracetam', 'Phenylpiracetam',
            'Levetiracetam', 'Brivaracetam', 'Perampanel', 'Topiramate', 'Zonisamide',
            'Acetazolamide', 'Methazolamide', 'Dichlorphenamide', 'Ethoxzolamide', 'Methicillin',
            'Nafcillin', 'Oxacillin', 'Cloxacillin', 'Dicloxacillin', 'Flucloxacillin',
            'Penicillin G', 'Penicillin V', 'Procaine', 'Benzathine', 'Methicillin',
            'Cloxacillin', 'Ticarcillin', 'Piperacillin', 'Mezlocillin', 'Azlocillin'
        ];
        
        const threshold = 0.6; // تم خفض العتبة من 0.7 إلى 0.6 لتحسين التعرف على النطق
        let bestMatch = name;
        let highestSimilarity = 0;
        
        for (const med of medicineNames) {
            const similarity = this.stringSimilarity(name.toLowerCase(), med.toLowerCase());
            if (similarity > threshold && similarity > highestSimilarity) {
                bestMatch = med;
                highestSimilarity = similarity;
            }
        }
        
        if (highestSimilarity > 0) {
            console.log(`💊 تم تصحيح اسم الدواء: ${name} → ${bestMatch} (تشابه: ${(highestSimilarity * 100).toFixed(1)}%)`);
            return bestMatch;
        }
        
        return name;
    }

    // حساب تشابه النصوص باستخدام مسافة ليفنشتاين
    stringSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        if (longer.length === 0) return 1.0;
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    // حساب مسافة ليفنشتاين بين نصين
    levenshteinDistance(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i-1) === a.charAt(j-1)) {
                    matrix[i][j] = matrix[i-1][j-1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i-1][j-1] + 1, // استبدال
                        matrix[i][j-1] + 1,    // إضافة
                        matrix[i-1][j] + 1     // حذف
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }
}

// إضافة أنماط CSS للرسائل المتحركة
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    #voiceInputBtn.listening {
        background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
        animation: pulse 1.5s infinite;
    }
    
    @keyframes pulse {
        0% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0.7); }
        70% { box-shadow: 0 0 0 10px rgba(255, 107, 107, 0); }
        100% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0); }
    }
`;
document.head.appendChild(style);

// تهيئة معالج الإدخال الصوتي عند تحميل الصفحة
let voiceInputProcessor = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('🎤 تهيئة نظام الإدخال الصوتي...');
    
    // انتظار تحميل جميع المكتبات
    setTimeout(() => {
        try {
            voiceInputProcessor = new VoiceInputProcessor();
            window.voiceInputProcessor = voiceInputProcessor;
            console.log('✅ تم تهيئة نظام الإدخال الصوتي بنجاح');
            
            // إعلام المستخدم بجاهزية الميكروفون
            if (window.showCustomAlert) {
                showCustomAlert('🎤 الميكروفون جاهز للاستخدام<br>اضغط على أيقونة الميكروفون بجانب أي حقل', 'info');
            }
        } catch (error) {
            console.error('❌ فشل في تهيئة نظام الإدخال الصوتي:', error);
            if (window.showCustomAlert) {
                showCustomAlert('❌ فشل في تهيئة الميكروفون<br>يرجى تحديث الصفحة', 'error');
            }
        }
    }, 1000); // انتظار ثانية للتأكد من تحميل جميع المكتبات
});

// جعل الكlas متاحاً عالمياً
window.VoiceInputProcessor = VoiceInputProcessor;

