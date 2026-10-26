// نظام البحث الصوتي العائم
(function() {
    'use strict';

    // التحقق من دعم المتصفح للبحث الصوتي
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.log('المتصفح لا يدعم البحث الصوتي');
        return;
    }

    // إنشاء كائن التعرف على الصوت
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    // إعدادات التعرف على الصوت
    recognition.lang = 'en-US'; 
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let isListening = false;

    // إنشاء الأيقونة العائمة
    const voiceButton = document.createElement('div');
    voiceButton.id = 'voiceSearchButton';
    voiceButton.innerHTML = '🎤';
    voiceButton.title = 'البحث الصوتي (اضغط للتحدث)';
    
    // تطبيق الأنماط
    const style = document.createElement('style');
    style.textContent = `
        #voiceSearchButton {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            cursor: pointer;
            box-shadow: 0 5px 20px rgba(102, 126, 234, 0.5);
            z-index: 9999;
            transition: all 0.3s ease;
            border: 3px solid white;
        }
        
        #voiceSearchButton:hover {
            transform: scale(1.1) translateY(-3px);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.7);
        }
        
        #voiceSearchButton.listening {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            animation: pulse 1.5s infinite;
        }
        
        #voiceSearchButton.success {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
        }
        
        #voiceSearchButton.error {
            background: linear-gradient(135deg, #ff6b6b 0%, #dc3545 100%);
        }
        
        @keyframes pulse {
            0%, 100% {
                transform: scale(1);
                box-shadow: 0 5px 20px rgba(240, 147, 251, 0.5);
            }
            50% {
                transform: scale(1.15);
                box-shadow: 0 8px 30px rgba(240, 147, 251, 0.8);
            }
        }
        
        #voiceSearchModal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            align-items: center;
            justify-content: center;
        }
        
        #voiceSearchModal.show {
            display: flex;
        }
        
        .voice-modal-content {
            background: white;
            padding: 40px;
            border-radius: 20px;
            text-align: center;
            max-width: 400px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        }
        
        .voice-modal-icon {
            font-size: 80px;
            margin-bottom: 20px;
            animation: pulse 1.5s infinite;
        }
        
        .voice-modal-text {
            font-size: 20px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
        }
        
        .voice-modal-subtext {
            font-size: 14px;
            color: #666;
        }
        
        .voice-result {
            background: #f8f9ff;
            padding: 15px;
            border-radius: 10px;
            margin-top: 20px;
            border: 2px solid #667eea;
        }
        
        .voice-result-text {
            font-size: 18px;
            color: #667eea;
            font-weight: bold;
        }
    `;
    document.head.appendChild(style);

    // إنشاء نافذة البحث الصوتي
    const modal = document.createElement('div');
    modal.id = 'voiceSearchModal';
    modal.innerHTML = `
        <div class="voice-modal-content">
            <div class="voice-modal-icon">🎤</div>
            <div class="voice-modal-text">استمع الآن...</div>
            <div class="voice-modal-subtext">تحدث بوضوح باللهجة المصرية</div>
            <div class="voice-result" id="voiceResult" style="display: none;">
                <div class="voice-result-text" id="voiceResultText"></div>
            </div>
        </div>
    `;

    // إضافة العناصر للصفحة
    document.body.appendChild(voiceButton);
    document.body.appendChild(modal);

    // وظيفة البحث في الصفحة الحالية
    function searchInCurrentPage(searchText) {
        const currentPage = window.location.pathname.split('/').pop();
        
        // البحث في صفحة المنتجات
        if (currentPage === 'products.html' || currentPage === 'limited-products.html' || currentPage === 'expiring-products.html') {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = searchText;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
        }
        
        // البحث في صفحة الصيدليات
        if (currentPage === 'pharmacies.html') {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = searchText;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
        }
        
        // البحث في صفحة الأوردرات
        if (currentPage === 'analytics.html') {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = searchText;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
        }

        return false;
    }

    // التعامل مع نتيجة التعرف على الصوت
    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        console.log('النص المسموع:', transcript);
        
        // عرض النتيجة
        document.getElementById('voiceResultText').textContent = transcript;
        document.getElementById('voiceResult').style.display = 'block';
        
        // تغيير لون الزر للنجاح
        voiceButton.classList.remove('listening');
        voiceButton.classList.add('success');
        
        // البحث في الصفحة الحالية
        setTimeout(function() {
            const found = searchInCurrentPage(transcript);
            
            if (found) {
                // إغلاق النافذة بعد ثانية
                setTimeout(function() {
                    modal.classList.remove('show');
                    voiceButton.classList.remove('success');
                }, 1000);
            } else {
                // إذا لم يتم العثور على حقل بحث
                document.querySelector('.voice-modal-text').textContent = 'تم التعرف على الصوت';
                document.querySelector('.voice-modal-subtext').textContent = 'لا يوجد حقل بحث في هذه الصفحة';
                
                setTimeout(function() {
                    modal.classList.remove('show');
                    voiceButton.classList.remove('success');
                }, 2000);
            }
        }, 500);
    };

    // التعامل مع الأخطاء
    recognition.onerror = function(event) {
        console.error('خطأ في التعرف على الصوت:', event.error);
        
        voiceButton.classList.remove('listening');
        voiceButton.classList.add('error');
        
        let errorMessage = 'حدث خطأ في التعرف على الصوت';
        
        switch(event.error) {
            case 'no-speech':
                errorMessage = 'لم يتم اكتشاف صوت';
                break;
            case 'audio-capture':
                errorMessage = 'لا يمكن الوصول للميكروفون';
                break;
            case 'not-allowed':
                errorMessage = 'يجب السماح باستخدام الميكروفون';
                break;
            case 'network':
                errorMessage = 'خطأ في الاتصال بالإنترنت';
                break;
        }
        
        document.querySelector('.voice-modal-text').textContent = errorMessage;
        document.querySelector('.voice-modal-subtext').textContent = 'حاول مرة أخرى';
        
        setTimeout(function() {
            modal.classList.remove('show');
            voiceButton.classList.remove('error');
        }, 2000);
    };

    // عند انتهاء التسجيل
    recognition.onend = function() {
        isListening = false;
        voiceButton.classList.remove('listening');
    };

    // عند بدء التسجيل
    recognition.onstart = function() {
        isListening = true;
        voiceButton.classList.add('listening');
    };

    // التعامل مع النقر على الزر
    voiceButton.addEventListener('click', function() {
        if (isListening) {
            recognition.stop();
            modal.classList.remove('show');
        } else {
            try {
                // إعادة تعيين النافذة
                document.querySelector('.voice-modal-icon').textContent = '🎤';
                document.querySelector('.voice-modal-text').textContent = 'استمع الآن...';
                document.querySelector('.voice-modal-subtext').textContent = 'تحدث بوضوح باللهجة المصرية';
                document.getElementById('voiceResult').style.display = 'none';
                
                modal.classList.add('show');
                recognition.start();
            } catch (error) {
                console.error('خطأ في بدء التعرف على الصوت:', error);
                alert('حدث خطأ في بدء البحث الصوتي. تأكد من السماح باستخدام الميكروفون.');
            }
        }
    });

    // إغلاق النافذة عند النقر خارجها
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            recognition.stop();
            modal.classList.remove('show');
        }
    });

    // اختصار لوحة المفاتيح: Ctrl+Shift+V للبحث الصوتي
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'V') {
            e.preventDefault();
            voiceButton.click();
        }
    });

    console.log('✅ نظام البحث الصوتي جاهز! (Ctrl+Shift+V للتفعيل)');
})();
