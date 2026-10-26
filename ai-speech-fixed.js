// محرك التعرف الصوتي المحسن للغة العربية مع ربط Supabase
// محدث للتعامل مع CORS ومشاكل الأمان في localhost - نسخة مصححة
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

        // إعداد معالجات الأحداث
        setupEventHandlers: function(onResult, onError) {
            // معالج النتائج
            this.recognition.onresult = async (event) => {
                console.log('📝 تم الحصول على نتائج التعرف الصوتي:', event.results.length, 'نتيجة');
                
                // معالجة جميع البدائل المتاحة للدقة الأفضل
                const results = event.results[0];
                let bestTranscript = results[0].transcript;
                let bestConfidence = results[0].confidence || 0;
                
                // البحث عن أفضل نتيجة بناءً على الثقة
                for (let i = 1; i < results.length; i++) {
                    const alternative = results[i];
                    const confidence = alternative.confidence || 0;
                    
                    if (confidence > bestConfidence) {
                        bestTranscript = alternative.transcript;
                        bestConfidence = confidence;
                    }
                }
                
                console.log('📝 أفضل نتيجة:', bestTranscript, '(ثقة:', (bestConfidence * 100).toFixed(1) + '%)');
                
                // معالجة خاصة لأسماء الأدوية
                if (this.targetField === 'productName') {
                    await this.processMedicationName(bestTranscript, onResult);
                } else {
                    if (onResult) onResult(bestTranscript);
                }
            };

            // معالج الأخطاء المحسن
            this.recognition.onerror = (event) => {
                console.error('❌ خطأ في التعرف الصوتي:', event.error);
                
                // معالجة الأخطاء الشائعة
                switch(event.error) {
                    case 'not-allowed':
                        this.showPermissionError('تم رفض إذن الميكروفون');
                        break;
                    case 'no-speech':
                        console.warn('🔇 لم يتم اكتشاف أي صوت');
                        break;
                    case 'audio-capture':
                        this.showPermissionError('لا يمكن الوصول للميكروفون');
                        break;
                    case 'network':
                        console.warn('🌐 مشكلة في الشبكة');
                        break;
                    case 'service-not-allowed':
                        this.showPermissionError('خدمة الميكروفون غير مسموحة');
                        break;
                    default:
                        console.error('❌ خطأ غير معروف:', event.error);
                }
                
                if (onError) onError(event.error);
            };

            // معالج نهاية الاستماع
            this.recognition.onend = () => {
                console.log('🔇 انتهى الاستماع');
                this.isListening = false;
                
                // تنظيف الـ stream
                if (microphoneStream) {
                    microphoneStream.getTracks().forEach(track => track.stop());
                    microphoneStream = null;
                }
            };
        },

        // معالجة أسماء الأدوية
        processMedicationName: async function(transcript, onResult) {
            console.log(`💊 معالجة اسم الدواء: "${transcript}"`);
            
            try {
                // عرض رسالة تحميل
                if (window.showCustomAlert) {
                    showCustomAlert('🔍 جاري التحقق من اسم الدواء...', 'info');
                }
                
                let finalName = transcript;
                
                // 1. استخدام المدقق الإملائي المحسن
                if (window.medicationSpellChecker) {
                    try {
                        finalName = await window.medicationSpellChecker.checkSpelling(transcript);
                        if (finalName !== transcript) {
                            console.log('✅ تم تصحيح اسم الدواء:', transcript, '->', finalName);
                            if (window.showCustomAlert) {
                                showCustomAlert(`✅ تم تصحيح اسم الدواء إلى: ${finalName}`, 'success');
                            }
                        }
                    } catch (spellError) {
                        console.warn('⚠️ المدقق الإملائي فشل:', spellError);
                    }
                }
                
                // 2. التحقق الإضافي عبر RxNav
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
                        console.warn('⚠️ RxNav فشل:', rxnavError);
                    }
                }
                
                // إرجاع النتيجة النهائية
                if (onResult) onResult(finalName);
                
            } catch (error) {
                console.error('❌ خطأ في معالجة اسم الدواء:', error);
                if (onResult) onResult(transcript); // استخدام النص الأصلي كخيار احتياطي
            }
        },

        // إيقاف الاستماع
        stopListening: function() {
            if (this.recognition && this.isListening) {
                this.recognition.stop();
                this.isListening = false;
                console.log('🔇 تم إيقاف الاستماع');
            }
        },

        // تنظيف الموارد
        cleanup: function() {
            if (microphoneStream) {
                microphoneStream.getTracks().forEach(track => track.stop());
                microphoneStream = null;
            }
            
            if (this.recognition) {
                this.recognition.stop();
                this.recognition = null;
            }
            
            permissionGranted = false;
            console.log('🧹 تم تنظيف موارد التعرف الصوتي');
        }
    };

    // تهيئة تلقائية عند تحميل الصفحة
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 تحميل AI Speech System...');
        console.log('🌐 Environment:', isLocalhost ? 'localhost' : 'production');
        console.log('🔐 Permission Status:', permissionGranted ? 'granted' : 'not requested');
    });

    console.log('✅ تم تحميل AI Speech System بنجاح!');
})();
