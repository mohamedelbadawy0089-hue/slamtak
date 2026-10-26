// حلول نهائية لمشاكل الميكروفون
// Microphone Ultimate Fix - Version 1.0

class MicrophoneFixer {
    constructor() {
        this.isInitialized = false;
        this.recognition = null;
        this.audioContext = null;
        this.stream = null;
    }

    // تهيئة شاملة للميكروفون
    async initialize() {
        console.log('🔧 بدء تهيئة الميكروفون الشاملة...');
        
        try {
            // 1. التحقق من الدعم الكامل
            if (!this.checkSupport()) {
                throw new Error('المتصفح لا يدعم الميكروفون');
            }

            // 2. طلب الإذن المسبق
            await this.requestPermissions();

            // 3. تهيئة التعرف الصوتي
            this.initializeRecognition();

            // 4. اختبار الميكروفون
            await this.testMicrophone();

            this.isInitialized = true;
            console.log('✅ تم تهيئة الميكروفون بنجاح');
            return true;

        } catch (error) {
            console.error('❌ فشل في تهيئة الميكروفون:', error);
            this.showSolution(error);
            return false;
        }
    }

    // التحقق من دعم المتصفح
    checkSupport() {
        const hasWebAudio = !!(window.AudioContext || window.webkitAudioContext);
        const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        const hasSpeechRecognition = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

        console.log('🔍 فحص الدعم:', {
            webAudio: hasWebAudio,
            getUserMedia: hasGetUserMedia,
            speechRecognition: hasSpeechRecognition
        });

        return hasWebAudio && hasGetUserMedia && hasSpeechRecognition;
    }

    // طلب الإذن بشكل احترافي
    async requestPermissions() {
        console.log('🔐 طلب إذن الميكروفون...');
        
        try {
            // طلب إذن الصوت مع أفضل إعدادات
            this.stream = await navigator.mediaDevices.getUserMedia({
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
            return true;

        } catch (error) {
            console.error('❌ خطأ في طلب الإذن:', error);
            
            if (error.name === 'NotAllowedError') {
                throw new Error('تم رفض إذن الميكروفون - يرجى السماح في إعدادات المتصفح');
            } else if (error.name === 'NotFoundError') {
                throw new Error('لم يتم العثور على ميكروفون - يرجى توصيل ميكروفون');
            } else if (error.name === 'NotReadableError') {
                throw new Error('الميكروفون مستخدم من تطبيق آخر');
            } else {
                throw new Error(`خطأ في الميكروفون: ${error.message}`);
            }
        }
    }

    // تهيئة التعرف الصوتي المحسن
    initializeRecognition() {
        console.log('🎤 تهيئة التعرف الصوتي...');
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        // إعدادات مثالية للدقة العالية
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.maxAlternatives = 5;
        this.recognition.lang = 'ar-EG';

        // معالجة الأخطاء المحسنة
        this.recognition.onerror = (event) => {
            console.error('❌ خطأ في التعرف الصوتي:', event.error);
            this.handleError(event.error);
        };

        this.recognition.onend = () => {
            console.log('🔇 انتهى الاستماع');
        };

        console.log('✅ تم تهيئة التعرف الصوتي');
    }

    // اختبار الميكروفون
    async testMicrophone() {
        console.log('🧪 اختبار الميكروفون...');
        
        return new Promise((resolve, reject) => {
            this.recognition.onresult = (event) => {
                const result = event.results[0][0];
                const confidence = (result.confidence * 100).toFixed(1);
                console.log(`✅ اختبار ناجح: "${result.transcript}" (ثقة: ${confidence}%)`);
                resolve(result);
            };

            this.recognition.onerror = (error) => {
                reject(new Error(`فشل الاختبار: ${error.error}`));
            };

            // بدء الاختبار
            this.recognition.start();

            // إيقاف بعد 3 ثواني
            setTimeout(() => {
                if (this.recognition) {
                    this.recognition.stop();
                }
            }, 3000);
        });
    }

    // معالجة الأخطاء وعرض الحلول
    handleError(error) {
        const solutions = {
            'not-allowed': {
                title: '🚫 تم رفض إذن الميكروفون',
                solution: '1. اضغط على أيقونة القفل في شريط العنوان\n2. ابحث عن "ميكروفون"\n3. اضغط "السماح"\n4. أعد تحميل الصفحة'
            },
            'no-speech': {
                title: '🔇 لم يتم اكتشاف صوت',
                solution: '1. تأكد من أن الميكروفون يعمل\n2. تحدث بوضوح وبقرب من الميكروفون\n3. تحقق من مستوى الصوت في إعدادات النظام'
            },
            'audio-capture': {
                title: '🎤 لا يمكن الوصول للميكروفون',
                solution: '1. أغلق التطبيقات التي تستخدم الميكروفون\n2. أعد تشغيل المتصفح\n3. تحقق من إعدادات الخصوصية في Windows'
            },
            'network': {
                title: '🌐 مشكلة في الشبكة',
                solution: '1. تحقق من اتصال الإنترنت\n2. جرب شبكة مختلفة\n3. تأكد من أن المتصفح متصل'
            },
            'service-not-allowed': {
                title: '🚫 خدمة الميكروفون غير مسموحة',
                solution: '1. افتح إعدادات المتصفح\n2. اذهب إلى الخصوصية والأمان\n3. فعل خدمات الصوت'
            }
        };

        const solution = solutions[error] || {
            title: `❌ خطأ غير معروف: ${error}`,
            solution: '1. أعد تشغيل المتصفح\n2. تحقق من تحديثات Windows\n3. استخدم متصفح مختلف'
        };

        this.showSolution(solution);
    }

    // عرض الحلول للمستخدم
    showSolution(solution) {
        if (window.showCustomAlert) {
            const message = `
                <div style="text-align: right; direction: rtl;">
                    <h4>${solution.title}</h4>
                    <p style="white-space: pre-line; margin: 10px 0;">${solution.solution}</p>
                    <button onclick="window.location.reload()" style="background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 10px;">
                        🔄 إعادة المحاولة
                    </button>
                </div>
            `;
            showCustomAlert(message, 'warning');
        } else {
            alert(`${solution.title}\n\n${solution.solution}`);
        }
    }

    // إصلاح تلقائي للمشاكل الشائعة
    async autoFix() {
        console.log('🔧 بدء الإصلاح التلقائي...');
        
        try {
            // 1. إيقاف أي تسجيلات نشطة
            if (this.recognition) {
                try {
                    this.recognition.stop();
                } catch (e) {
                    console.log('لا يوجد تسجيل نشط');
                }
            }

            // 2. إيقاف الـ stream
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
            }

            // 3. انتظر ثانية
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 4. إعادة التهيئة
            await this.initialize();

            console.log('✅ تم الإصلاح التلقائي بنجاح');
            return true;

        } catch (error) {
            console.error('❌ فشل الإصلاح التلقائي:', error);
            return false;
        }
    }

    // الحصول على معلومات الميكروفون
    async getMicrophoneInfo() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const microphones = devices.filter(device => device.kind === 'audioinput');
            
            return {
                count: microphones.length,
                devices: microphones.map(mic => ({
                    name: mic.label || 'ميكروفون غير معروف',
                    id: mic.deviceId,
                    isDefault: mic.deviceId === 'default'
                })),
                hasPermission: microphones.length > 0
            };
        } catch (error) {
            console.error('❌ خطأ في الحصول على معلومات الميكروفون:', error);
            return null;
        }
    }

    // تنظيف الموارد
    cleanup() {
        console.log('🧹 تنظيف موارد الميكروفون...');
        
        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
        }
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

// تصدير للاستخدام العام
window.MicrophoneFixer = MicrophoneFixer;

// تهيئة تلقائية عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 تحميل Microphone Fixer...');
    
    window.microphoneFixer = new MicrophoneFixer();
    
    // محاولة التهيئة التلقائية
    const success = await window.microphoneFixer.initialize();
    
    if (success) {
        console.log('🎉 الميكروفون جاهز للاستخدام!');
        
        // إضافة زر الإصلاح التلقائي للصفحة
        const fixButton = document.createElement('button');
        fixButton.innerHTML = '🔧 إصلاح الميكروفون';
        fixButton.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #dc3545;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 5px;
            cursor: pointer;
            z-index: 9999;
            font-size: 14px;
        `;
        
        fixButton.onclick = async () => {
            fixButton.innerHTML = '🔄 جاري الإصلاح...';
            fixButton.disabled = true;
            
            await window.microphoneFixer.autoFix();
            
            fixButton.innerHTML = '🔧 إصلاح الميكروفون';
            fixButton.disabled = false;
        };
        
        document.body.appendChild(fixButton);
    } else {
        console.log('❌ فشل في تهيئة الميكروفون');
    }
});

console.log('✅ تم تحميل Microphone Fixer بنجاح!');
