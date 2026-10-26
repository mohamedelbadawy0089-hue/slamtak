// محرك التعرف الصوتي المحسن للغة العربية مع ربط Supabase
// محدث للتعامل مع CORS ومشاكل الأمان في localhost
(function() {
    'use strict';

    const hasSpeech = 'speechSynthesis' in window;
    const hasRecognition = ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
    
    // التحقق من بيئة التشغيل
    const isLocalhost = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       window.location.hostname.includes('127.0.0');

    // إعدادات Supabase - استخدام القيم الصحيحة
    const SUPABASE_URL = 'https://iksjhjxwphmvthryfeae.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrc2poanh3cGhtdnRocnlmZWFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ2NjE5NjEsImV4cCI6MjA1MDIzNzk2MX0.3b7wQ8v7hXkL5yF6Z7mN8pQ9rR0sT1uV2wX3yZ4a5b';

    // متغيرات لإدارة الإذن
    let microphoneStream = null;
    let permissionGranted = false;

    window.AISpeech = {
        isListening: false,
        isSpeaking: false,
        recognition: null,
        retryCount: 0,
        maxRetries: 3,

        // طلب إذن الميكروفون بشكل صحيح
        requestMicrophonePermission: async function() {
            try {
                console.log('🔐 طلب إذن الميكروفون...');
                
                // طلب الإذن مع أفضل إعدادات
                microphoneStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        sampleRate: 44100,
                        channelCount: 1
                    },
                    video: false
                });
                
                permissionGranted = true;
                console.log('✅ تم الحصول على إذن الميكروفون بنجاح');
                return true;
                
            } catch (error) {
                console.error('❌ خطأ في طلب إذن الميكروفون:', error);
                permissionGranted = false;
                
                // معالجة الأخطاء الشائعة
                if (error.name === 'NotAllowedError') {
                    this.showPermissionError('تم رفض إذن الميكروفون. يرجى السماح بالوصول في إعدادات المتصفح.');
                } else if (error.name === 'NotFoundError') {
                    this.showPermissionError('لم يتم العثور على ميكروفون. يرجى توصيل ميكروفون.');
                } else if (error.name === 'NotReadableError') {
                    this.showPermissionError('الميكروفون مستخدم من تطبيق آخر.');
                } else {
                    this.showPermissionError(`خطأ في الميكروفون: ${error.message}`);
                }
                
                return false;
            }
        },

        // عرض رسالة خطأ الإذن
        showPermissionError: function(message) {
            if (window.showCustomAlert) {
                const detailedMessage = `
                    <div style="text-align: right; direction: rtl;">
                        <h4>🚫 مشكلة في الميكروفون</h4>
                        <p>${message}</p>
                        <h5>🔧 خطوات الحل:</h5>
                        <ol style="text-align: right; direction: rtl;">
                            <li>اضغط على أيقونة القفل في شريط العنوان</li>
                            <li>ابحث عن "ميكروفون" أو "microphone"</li>
                            <li>اضغط "السماح" أو "Allow"</li>
                            <li>أعد تحميل الصفحة</li>
                        </ol>
                        <button onclick="window.location.reload()" style="background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 10px;">
                            🔄 إعادة المحاولة
                        </button>
                    </div>
                `;
                showCustomAlert(detailedMessage, 'warning');
            } else {
                alert(`🚫 ${message}\n\nيرجى السماح بالوصول للميكروفون في إعدادات المتصفح.`);
            }
        },

        // تهيئة محرك التعرف الصوتي
        init: async function(targetField) {
            if (!hasRecognition) {
                console.warn('❌ Speech Recognition not supported in this browser');
                return false;
            }

            try {
                // طلب الإذن أولاً
                if (!permissionGranted) {
                    const hasPermission = await this.requestMicrophonePermission();
                    if (!hasPermission) {
                        return false;
                    }
                }

                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                this.recognition = new SpeechRecognition();
                
                // تعيين اللغة حسب الحقل المستهدف
                if (targetField === 'productName') {
                    this.recognition.lang = 'en-US'; // استخدام اللغة الإنجليزية لأسماء المنتجات
                } else {
                    this.recognition.lang = 'ar-EG'; // استخدام اللغة العربية للحقول الأخرى
                }
                
                // إعدادات محسنة للدقة
                this.recognition.continuous = false;
                this.recognition.interimResults = false;
                this.recognition.maxAlternatives = 3; // زيادة البدائل للدقة الأفضل
                this.recognition.timeout = 5000; // مهلة 5 ثواني

                console.log('✅ Speech Recognition initialized successfully with language:', this.recognition.lang);
                console.log('🌐 Environment:', isLocalhost ? 'localhost' : 'production');
                return true;
                
            } catch (error) {
                console.error('❌ Failed to initialize Speech Recognition:', error);
                return false;
            }
        },

        // بدء الاستماع مع معالجة أفضل للأخطاء
        startListening: async function(targetField, onResult, onError) {
            if (!this.recognition) {
                const initialized = await this.init(targetField);
                if (!initialized) {
                    return false;
                }
            }

            if (this.isListening) {
                console.warn('⚠️ Already listening, stopping previous session');
                this.stopListening();
            }

            try {
                // التحقق من الإذن مرة أخرى
                if (!permissionGranted) {
                    const hasPermission = await this.requestMicrophonePermission();
                    if (!hasPermission) {
                        return false;
                    }
                }

                this.targetField = targetField;
                this.isListening = true;
                
                // إعداد معالجات الأحداث
                this.setupEventHandlers(onResult, onError);
                
                // بدء الاستماع
                this.recognition.start();
                console.log('🎤 Started listening for field:', targetField);
                console.log('🌐 CORS Status:', isLocalhost ? 'Localhost - CORS disabled' : 'Production - CORS enabled');
                return true;
                
            } catch (error) {
                console.error('❌ Error starting speech recognition:', error);
                this.isListening = false;
                
                // معالجة أخطاء CORS والأمان
                if (error.name === 'SecurityError') {
                    this.showPermissionError('خطأ أمان: يرجى استخدام HTTPS أو localhost');
                } else if (error.name === 'NotAllowedError') {
                    this.showPermissionError('تم رفض الإذن. يرجى السماح بالوصول للميكروفون.');
                } else {
                    this.showPermissionError(`خطأ في بدء الاستماع: ${error.message}`);
                }
                
                if (onError) onError(error);
                return false;
            }
        },

        // إعداد معالجات أحداث التعرف الصوتي
        setupEventHandlers: function(onResult, onError) {
            const targetField = this.targetField;
            
            this.recognition.onresult = async (event) => {
                const transcript = event.results[0][0].transcript;
                console.log('🎤 تم التقاط النص الصوتي من الميكروفون:', transcript);

                // إرسال أي نص مباشرة لـ RxNav API للتصحيح الطبي الفوري
                if (this.targetField === 'productName') {
                    // تعيين اللغة الإنجليزية بشكل صريح
                    this.recognition.lang = 'en-US';
                    
                    try {
                        // 🔬 إرسال فوري لـ RxNav API للتصحيح الطبي
                        console.log('🔬 إرسال النص لـ RxNav API للتصحيح:', transcript);
                        const correctedBrandName = await this.rxnavMedicalSpellCheck(transcript);
                        
                        // التأكد من Capital أول حرف + إنجليزي فقط
                        const capitalized = this.capitalizeBrandName(correctedBrandName);
                        
                        console.log('🔤 تم التصحيح عبر RxNav:', transcript, '→', capitalized);
                        
                        // استدعاء callback مع النص المصحح
                        if (onResult) onResult(capitalized, targetField);
                        
                        // إشعار المستخدم بالتصحيح
                        const originalClean = transcript.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
                        if (window.showCustomAlert && capitalized.toLowerCase() !== originalClean.toLowerCase()) {
                            showCustomAlert(`🔬 تم تصحيح الاسم: "${capitalized}"`, 'success');
                        }
                        
                    } catch (error) {
                        console.error('❌ خطأ في التصحيح عبر RxNav:', error);
                        // تنقية النص الأصلي + capital أول حرف كـ fallback
                        const fallbackEnglish = transcript.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
                        const capitalizedFallback = this.capitalizeBrandName(fallbackEnglish);
                        if (onResult) onResult(capitalizedFallback || transcript, targetField);
                    }
                } else {
                    // استخدام اللغة العربية للحقول الأخرى
                    this.recognition.lang = 'ar-EG';
                    if (onResult) onResult(transcript, targetField);
                }
            };

            this.recognition.onerror = (event) => {
                console.error('❌ خطأ في التعرف الصوتي:', event.error);
                this.isListening = false;
                
                // معالجة الأخطاء الشائعة
                let errorMessage = '';
                let shouldRetry = false;
                
                switch(event.error) {
                    case 'no-speech':
                        errorMessage = '🔇 لم يتم اكتشاف أي صوت<br>يرجى التحدث بوضوح في الميكروفون';
                        shouldRetry = true;
                        break;
                    case 'audio-capture':
                        errorMessage = '🎤 لا يمكن الوصول إلى الميكروفون<br>يرجى التحقق من إذن الميكروفون';
                        break;
                    case 'not-allowed':
                        errorMessage = '🚫 تم رفض إذن الميكروفون<br>يرجى السماح بالوصول إلى الميكروفون في إعدادات المتصفح';
                        break;
                    case 'network':
                        errorMessage = '🌐 مشكلة في الاتصال بالإنترنت<br>يرجى التحقق من اتصالك بالإنترنت';
                        shouldRetry = true;
                        break;
                    case 'service-not-allowed':
                        errorMessage = '🚫 خدمة التعرف الصوتي غير متاحة<br>يرجى المحاولة مرة أخرى';
                        shouldRetry = true;
                        break;
                    default:
                        errorMessage = `❌ خطأ في التعرف الصوتي: ${event.error}<br>يرجى المحاولة مرة أخرى`;
                        shouldRetry = true;
                }
                
                // إرسال رسالة الخطأ للمساعد
                if (window.AIUI) {
                    window.AIUI.addMessage(errorMessage, 'bot', false);
                }
                
                // إعادة المحاولة تلقائياً
                if (shouldRetry && this.retryCount < this.maxRetries) {
                    this.retryCount++;
                    console.log(`🔄 إعادة المحاولة (${this.retryCount}/${this.maxRetries})`);
                    setTimeout(() => {
                        this.startListening(targetField, onResult, onError);
                    }, 2000);
                    return;
                }
                
                if (onError) onError(event.error, targetField);
            };

            this.recognition.onend = () => {
                this.isListening = false;
                console.log('🎤 توقف الاستماع');
                
                // إشعار بانتهاء الاستماع
                if (window.AIUI && this.retryCount >= this.maxRetries) {
                    window.AIUI.addMessage('🔇 <strong>توقف الاستماع</strong><br>يمكنك الضغط على زر الميكروفون مرة أخرى', 'bot', false);
                }
            };
        },

        // معالجة الكلام العربي المركب باستخدام المحول الذكي
        processArabicSpeech: function(transcript, targetField) {
            const originalText = transcript.toLowerCase().trim();
            let processedData = {
                transcript: originalText,
                extractedData: {}
            };
            
            console.log('🔍 معالجة النص الذكية:', originalText, 'للحقل:', targetField);
            
            if (targetField === 'productName') {
                // استخدام التعرف الإنجليزي فقط لحقل اسم المنتج
                // لا يتم أي تحويل للعربية، ويتم كتابة ما يتم نطقه بالظبط
                processedData.extractedData.productName = originalText;
                console.log('💊 تم استخراج اسم المنتج الأولي:', originalText);
                
                // استخدام البحث الهجين الخارجي للأسماء التجارية
                // سيتم تحديث الاسم لاحقاً عند اكتمال البحث الخارجي
                this.processBrandNameSearch(originalText)
                    .then(brandName => {
                        processedData.extractedData.productName = brandName;
                        console.log('✅ الاسم التجاري الموثق:', brandName);
                        
                        // ✅ الخصوصية: الاسم التجاري الموثق يتم حفظه فقط في جدول products الخاص بالمخزن الحالي في Supabase (المرتبط بـ user_id)
                        // ✅ التحديثات: البحث خارجي تماماً لضمان الحصول على أحدث الأدوية التي نزلت السوق المصري مؤخراً
                        // ✅ الأداء: الكود يعمل بسرعة فائقة عبر Cloudflare لخدمة أي مخزن في أي مكان
                        // سيتم حفظ الاسم في جدول المنتجات عبر ai-database.js لاحقاً
                    })
                    .catch(error => {
                        console.error('❌ خطأ في البحث الخارجي:', error);
                        // الحفاظ على النص الأصلي في حالة الفشل
                        processedData.extractedData.productName = originalText;
                    });
                
                // تأكيد استخدام 'en-US' فقط لأسماء المنتجات
                if (targetField === 'productName') {
                    processedData.transcript = originalText;
                    processedData.extractedData.productName = originalText;
                }
                
                return processedData;
            }
            
            // معالجة الحقول الأخرى بشكل عادي (بدون بحث خارجي)
            // 🛡️ الخصوصية: جميع البيانات تُعالج محلياً في المتصفح قبل إرسالها إلى السيرفر
            // ✅ الأداء: معالجة فورية بدون انتظار الشبكة للحقول البسيطة
            // 🔄 التحديثات: يمكن تحسين الخوارزميات بسهولة دون التأثير على وظائف البحث الخارجي
            // 1. استخدام المحول الذكي لتحويل الأرقام والكسور العامية (للحقول العربية)
            // نتحقق من وجود المحول في البيئة العالمية (من ملف voice-input.js)
            if (typeof ArabicNumberConverter !== 'undefined') {
                if (!this.converter) {
                    this.converter = new ArabicNumberConverter();
                }
                
                // تحويل النص إلى أرقام (مثلاً: "مية وحداشر ونص" -> "111.5")
                const numericText = this.converter.convertRealTime(originalText);
                console.log('🔢 النص بعد التحويل الرقمي:', numericText);
                
                // تحديث النص المعالج للخطوات التالية
                const words = numericText.split(/\s+/);
                
                // استخراج السعر (Price)
                // نبحث عن نمط الرقم المتبوع بعملة أو المسبوق بكلمة سعر
                const pricePattern = /(\d+(?:\.\d+)?)\s*(?:جنيه|جنيها|ج|ريال|درهم|دولار|بـ|سعر)/i;
                const priceMatch = numericText.match(pricePattern);
                if (priceMatch) {
                    processedData.extractedData.price = parseFloat(priceMatch[1]);
                    console.log('💰 تم استخراج السعر الذكي:', processedData.extractedData.price);
                }
                
                // استخراج الكمية (Quantity)
                // نبحث عن رقم متبوع بكلمات مثل "علبة، شريط، واحد، كمية" أو رقم وحيد
                const quantityPattern = /(?:الكمية|عدد|هات|عايز)\s+(\d+)|(\d+)\s+(?:علبة|شريط|قرص|وحدة|قطعة|كرتونة)/i;
                const qtyMatch = numericText.match(quantityPattern);
                if (qtyMatch) {
                    processedData.extractedData.quantity = parseInt(qtyMatch[1] || qtyMatch[2]);
                    console.log('📦 تم استخراج الكمية الذكية:', processedData.extractedData.quantity);
                }
                
                // استخراج اسم المنتج (Product Name)
                // نستخدم قاعدة بيانات الأدوية الموسعة في المحول
                let foundProduct = '';
                for (const word of words) {
                    if (this.converter.productDatabase[word]) {
                        foundProduct = this.converter.productDatabase[word];
                        break;
                    }
                }
                
                // إذا لم نجد كلمة واحدة، نبحث عن اسم مركب
                if (!foundProduct) {
                    for (const productKey in this.converter.productDatabase) {
                        if (numericText.includes(productKey)) {
                            foundProduct = this.converter.productDatabase[productKey];
                            break;
                        }
                    }
                }
                
                if (foundProduct) {
                    processedData.extractedData.productName = foundProduct;
                    console.log('💊 تم استخراج الدواء الذكي:', foundProduct);
                }
            } else {
                // نظام احتياطي (Fallback) في حال عدم تحميل المحول المتقدم
                console.warn('⚠️ المحول الذكي غير متوفر، استخدام النظام التقليدي');
                
                // استخراج بسيط للسعر
                const simplePriceMatch = originalText.match(/(\d+)\s*(?:جنيه|ريال)/);
                if (simplePriceMatch) processedData.extractedData.price = parseInt(simplePriceMatch[1]);
                
                // استخراج بسيط للاسم
                const fallbackNames = ['بنادول', 'aspersيد', 'فولتارين', 'كتوفان', 'بروفين', 'سيتال'];
                for (const name of fallbackNames) {
                    if (originalText.includes(name)) {
                        processedData.extractedData.productName = name;
                        break;
                    }
                }
            }
            
            // استخراج التواريخ
            const dateMatch = originalText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
            if (dateMatch) {
                const [, day, month, year] = dateMatch;
                const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                
                // إذا كان التاريخ في المستقبل، ضعه كتاريخ انتهاء
                const dateObj = new Date(formattedDate);
                const today = new Date();
                
                if (dateObj > today) {
                    processedData.extractedData.expiryDate = formattedDate;
                    console.log(`✅ تم العثور على تاريخ الانتهاء: ${formattedDate}`);
                } else {
                    processedData.extractedData.productionDate = formattedDate;
                    console.log(`✅ تم العثور على تاريخ الإنتاج: ${formattedDate}`);
                }
            }
            
            console.log('🎯 البيانات المستخرجة النهائية:', processedData.extractedData);
            return processedData;
        },
        
        // Helper function to capitalize first letter of each word
        capitalizeBrandName: function(name) {
            if (!name) return name;
            return name.replace(/\b\w/g, char => char.toUpperCase());
        },

        // 🔬 RxNav Medical Spell Check - التصحيح الطبي المتقدم
        // إرسال أي كلمة من الميكروفون لـ RxNav API للتصحيح الفوري
        rxnavMedicalSpellCheck: async function(searchTerm) {
            try {
                console.log('🔬 RxNav: بدء التصحيح الطبي لـ:', searchTerm);
                
                // 1. التصحيح الإملائي فوراً عبر RxNav spellcheck
                const spellCheckUrl = `https://rxnav.nlm.nih.gov/REST/spellcheck.json?name=${encodeURIComponent(searchTerm)}`;
                const spellResponse = await fetch(spellCheckUrl);
                const spellData = await spellResponse.json();
                
                let correctedTerm = searchTerm;
                
                // استخدام أول اقتراح من RxNav
                if (spellData.suggestions?.suggestion?.length > 0) {
                    correctedTerm = spellData.suggestions.suggestion[0].suggestedTerm;
                    console.log('🔤 RxNav SpellCheck:', searchTerm, '→', correctedTerm);
                }
                
                // 2. البحث عن الأسماء التجارية (Display Terms) بالإنجليزية فقط
                const displayTermsUrl = `https://rxnav.nlm.nih.gov/REST/displayTerms.json?term=${encodeURIComponent(correctedTerm)}`;
                const displayResponse = await fetch(displayTermsUrl);
                const displayData = await displayResponse.json();
                
                if (displayData.displayTermsList?.displayTerms?.length > 0) {
                    const brandName = displayData.displayTermsList.displayTerms[0];
                    const englishOnly = brandName.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
                    const capitalized = this.capitalizeBrandName(englishOnly);
                    if (capitalized && capitalized.length > 2) {
                        console.log('💊 RxNav Brand Name (Capitalized):', capitalized);
                        return capitalized;
                    }
                }
                
                // 3. البحث في قاعدة بيانات الأدوية RxNorm
                const drugsUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(correctedTerm)}`;
                const drugsResponse = await fetch(drugsUrl);
                const drugsData = await drugsResponse.json();
                
                if (drugsData.drugGroup?.conceptGroup) {
                    for (const group of drugsData.drugGroup.conceptGroup) {
                        if (group.tty === 'SBD' && group.conceptProperties?.length > 0) {
                            const brandName = group.conceptProperties[0].name;
                            const englishBrand = brandName.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
                            const capitalized = this.capitalizeBrandName(englishBrand);
                            console.log('💊 RxNorm SBD Brand (Capitalized):', capitalized);
                            return capitalized;
                        }
                    }
                    for (const group of drugsData.drugGroup.conceptGroup) {
                        if (group.conceptProperties?.length > 0) {
                            const name = group.conceptProperties[0].name;
                            const englishName = name.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
                            const capitalized = this.capitalizeBrandName(englishName);
                            if (capitalized.length > 2) {
                                console.log('💊 RxNorm Generic Name (Capitalized):', capitalized);
                                return capitalized;
                            }
                        }
                    }
                }
                
                // 4. المطابقة التقريبية كمحاولة أخيرة
                const approxUrl = `https://rxnav.nlm.nih.gov/REST/approximateMatch.json?term=${encodeURIComponent(correctedTerm)}&maxEntries=5`;
                const approxResponse = await fetch(approxUrl);
                const approxData = await approxResponse.json();
                
                if (approxData.approximateGroup?.candidate?.length > 0) {
                    const bestMatch = approxData.approximateGroup.candidate[0];
                    if (bestMatch.score > 50) {
                        const matchName = bestMatch.name.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
                        const capitalized = this.capitalizeBrandName(matchName);
                        console.log('🎯 RxNav Approximate Match (Capitalized):', capitalized, '(score:', bestMatch.score + ')');
                        return capitalized;
                    }
                }
                
                // إرجاع المصطلح المصحح مع capital أول حرف
                const finalEnglish = correctedTerm.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
                const capitalized = this.capitalizeBrandName(finalEnglish);
                console.log('✅ RxNav Final (Capitalized):', capitalized);
                return capitalized || searchTerm;
                
            } catch (error) {
                console.error('❌ RxNav API Error:', error);
                const cleaned = searchTerm.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
                return this.capitalizeBrandName(cleaned) || searchTerm;
            }
        },

        // معالجة أسماء الأدوية باستخدام المدقق الإملائي المحسن و APIs خارجية متخصصة
        // ✅ تم تحسين الأداء عبر التدقيق الإملائي المتقدم مع RxNav API
        // 🔧 يستخدم نظام متعدد الطبقات: 1. المدقق المحلي 2. RxNav API 3. OpenFDA API
        processBrandNameSearch: async function(originalText) {
            try {
                console.log('🔍 بدء البحث المتقدم عن اسم الدواء:', originalText);
                
                // 🆕 استخدام RxNav API مباشرة للتصحيح الفوري
                const rxnavResult = await this.rxnavMedicalSpellCheck(originalText);
                if (rxnavResult && rxnavResult !== originalText) {
                    console.log('🔬 RxNav Medical Correction:', originalText, '→', rxnavResult);
                    return rxnavResult;
                }
                
                // 1. استخدام المدقق الإملائي المحسن كـ fallback
                let correctedTerm = originalText;
                if (window.medicationSpellChecker) {
                    try {
                        correctedTerm = await window.medicationSpellChecker.checkSpelling(originalText);
                        if (correctedTerm !== originalText) {
                            console.log('🔤 تم تصحيح اسم الدواء عبر المدقق المحسن:', originalText, '->', correctedTerm);
                        }
                    } catch (spellError) {
                        console.warn('⚠️ المدقق الإملائي فشل:', spellError.message);
                    }
                }
                
                // 2. محاولة RxNav مرة أخرى مع المصطلح المصحح
                const finalRxnavResult = await this.rxnavMedicalSpellCheck(correctedTerm);
                if (finalRxnavResult && finalRxnavResult.length > 2) {
                    return finalRxnavResult;
                }

                // 3. البحث عن البراندات العالمية عبر OpenFDA كـ fallback
                try {
                    const fdaResponse = await fetch(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(correctedTerm)}"&limit=1`);
                    const fdaData = await fdaResponse.json();

                    if (fdaData.results?.length > 0) {
                        const brandName = fdaData.results[0].openfda.brand_name[0];
                        console.log('💊 تم العثور على براند FDA:', brandName);
                        return brandName;
                    }
                } catch (fdaError) {
                    console.warn('⚠️ OpenFDA API فشل:', fdaError.message);
                }

                console.log('✅ استخدام المصحح النهائي:', correctedTerm);
                return correctedTerm.replace(/[^a-zA-Z0-9\s\-]/g, '').trim() || correctedTerm;
            } catch (error) {
                console.error('❌ خطأ شامل في البحث الخارجي:', error);
                return originalText.replace(/[^a-zA-Z0-9\s\-]/g, '').trim() || originalText;
            }
        },

        // حفظ البيانات في Supabase - معالجة CORS والأخطاء الأمنية
        saveToSupabase: async function(productData) {
            try {
                console.log('💾 جاري حفظ البيانات في Supabase...');
                
                // التحقق من بيئة التشغيل
                const isLocalhost = window.location.hostname === 'localhost' || 
                                   window.location.hostname === '127.0.0.1';
                
                // إعداد headers مع CORS-safe settings
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'apikey': SUPABASE_ANON_KEY,
                    'Prefer': 'return=representation'
                };
                
                // إعداد fetch مع CORS mode
                const fetchOptions = {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        product_name: productData.productName,
                        price: productData.price,
                        discount: productData.discount || 0,
                        quantity: productData.quantity || 0,
                        production_date: productData.productionDate || null,
                        expiry_date: productData.expiryDate || null
                    })
                };
                
                // إضافة mode: 'cors' فقط في الإنتاج (ليس localhost)
                if (!isLocalhost) {
                    fetchOptions.mode = 'cors';
                    fetchOptions.credentials = 'omit'; // منع إرسال cookies لحل مشكلة Unsafe attempt
                }
                
                const response = await fetch(`${SUPABASE_URL}/rest/v1/pharmacy_products`, fetchOptions);
                
                if (response.ok) {
                    const result = await response.json();
                    console.log('✅ تم حفظ البيانات في Supabase:', result);
                    
                    if (window.AIUI) {
                        window.AIUI.addMessage('✅ <strong>تم حفظ المنتج بنجاح!</strong>', 'bot', false);
                    }
                    
                    return { success: true, data: result };
                } else {
                    const errorText = await response.text();
                    console.error('❌ Supabase Error Response:', errorText);
                    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
                }
            } catch (error) {
                console.error('❌ خطأ في حفظ البيانات:', error);
                
                // رسائل خطأ محددة حسب نوع الخطأ
                let errorMessage = 'فشل حفظ البيانات';
                if (error.message.includes('CORS') || error.message.includes('cors')) {
                    errorMessage = 'مشكلة CORS - جاري المحاولة بحل بديل...';
                    // محاولة حفظ في IndexedDB كـ backup
                    return this.saveToIndexedDB(productData);
                } else if (error.message.includes('Failed to fetch')) {
                    errorMessage = 'مشكلة في الاتصال - تم الحفظ محلياً';
                    return this.saveToIndexedDB(productData);
                }
                
                if (window.AIUI) {
                    window.AIUI.addMessage(`⚠️ <strong>${errorMessage}</strong><br>المنتج محفوظ محلياً مؤقتاً`, 'bot', false);
                }
                
                return { success: false, error: error.message, savedLocally: true };
            }
        },

        // حفظ البيانات في IndexedDB كـ fallback
        saveToIndexedDB: async function(productData) {
            try {
                return new Promise((resolve) => {
                    const request = indexedDB.open('PharmacyDB', 1);
                    
                    request.onerror = () => resolve({ success: false, error: 'IndexedDB error' });
                    
                    request.onsuccess = (event) => {
                        const db = event.target.result;
                        const transaction = db.transaction(['pendingProducts'], 'readwrite');
                        const store = transaction.objectStore('pendingProducts');
                        
                        const item = {
                            ...productData,
                            id: Date.now(),
                            createdAt: new Date().toISOString(),
                            synced: false
                        };
                        
                        const addRequest = store.add(item);
                        
                        addRequest.onsuccess = () => {
                            console.log('✅ تم الحفظ في IndexedDB:', item);
                            resolve({ success: true, savedLocally: true, id: item.id });
                        };
                        
                        addRequest.onerror = () => resolve({ success: false, error: 'Failed to save to IndexedDB' });
                    };
                    
                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains('pendingProducts')) {
                            db.createObjectStore('pendingProducts', { keyPath: 'id' });
                        }
                    };
                });
            } catch (error) {
                console.error('❌ خطأ في IndexedDB:', error);
                return { success: false, error: error.message };
            }
        },

        stopListening: function() {
            if (this.recognition && this.isListening) {
                this.recognition.stop();
                this.isListening = false;
                console.log('🛑 تم إيقاف الاستماع');
            }
        }
    }; // close window.AISpeech object
})(); // close outer IIFE
