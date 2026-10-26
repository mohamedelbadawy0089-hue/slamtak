// نظام التحقق من صحة المدخلات - Validation System
(function() {
    'use strict';

    window.AIValidation = {
        // صوت التنبيه
        beep: function(type) {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = type === 'success' ? 880 : 220;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.4);
            } catch (e) {
                console.warn('Audio context error:', e);
            }
        },

        // التحدث بالخطأ
        speak: function(text) {
            if ('speechSynthesis' in window) {
                speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'ar-EG';
                utterance.rate = 0.9;
                utterance.pitch = 1;
                utterance.volume = 1;
                
                const voices = speechSynthesis.getVoices();
                const arVoice = voices.find(v => v.lang.startsWith('ar'));
                if (arVoice) utterance.voice = arVoice;
                
                speechSynthesis.speak(utterance);
            }
        },

        // قواعد التحقق
        rules: {
            phone: {
                validate: (value) => /^01[0-9]{9}$/.test(value),
                message: 'رقم الهاتف يجب أن يكون 11 رقماً ويبدأ بصفر'
            },
            email: {
                validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
                message: 'البريد الإلكتروني غير صحيح'
            },
            required: {
                validate: (value) => value && value.trim().length > 0,
                message: 'هذا الحقل مطلوب'
            },
            number: {
                validate: (value) => !isNaN(value) && value >= 0,
                message: 'يجب إدخال رقم صحيح'
            },
            password: {
                validate: (value) => value && value.length >= 6,
                message: 'الباسورد يجب أن يكون 6 أحرف على الأقل'
            },
            name: {
                validate: (value) => value && value.trim().length >= 2,
                message: 'الاسم يجب أن يكون حرفين على الأقل'
            }
        },

        // تطبيق التحقق على حقل
        validateField: function(input, ruleName) {
            const rule = this.rules[ruleName];
            if (!rule) return true;

            const value = input.value;
            const isValid = rule.validate(value);

            if (!isValid) {
                // تغيير لون الإطار للأحمر
                input.style.border = '3px solid #dc3545';
                input.style.boxShadow = '0 0 10px rgba(220, 53, 69, 0.5)';
                
                // صوت تنبيه
                this.beep('error');
                
                // رسالة صوتية
                this.speak('عفواً، ' + rule.message);
                
                // رسالة مرئية
                this.showError(input, rule.message);
                
                return false;
            } else {
                // تغيير لون الإطار للأخضر
                input.style.border = '2px solid #28a745';
                input.style.boxShadow = '0 0 10px rgba(40, 167, 69, 0.3)';
                
                // إزالة رسالة الخطأ
                this.removeError(input);
                
                return true;
            }
        },

        // عرض رسالة خطأ
        showError: function(input, message) {
            this.removeError(input);
            
            const errorDiv = document.createElement('div');
            errorDiv.className = 'ai-validation-error';
            errorDiv.textContent = '⚠️ ' + message;
            errorDiv.style.cssText = 'color:#dc3545;font-size:13px;margin-top:5px;font-weight:bold;animation:shake 0.5s;';
            
            input.parentNode.insertBefore(errorDiv, input.nextSibling);
        },

        // إزالة رسالة خطأ
        removeError: function(input) {
            const next = input.nextSibling;
            if (next && next.className === 'ai-validation-error') {
                next.remove();
            }
        },

        // تفعيل التحقق التلقائي
        enableAutoValidation: function(formId, rules) {
            const form = document.getElementById(formId);
            if (!form) return;

            for (const fieldId in rules) {
                const input = document.getElementById(fieldId);
                if (!input) continue;

                const ruleName = rules[fieldId];

                // التحقق عند الكتابة
                input.addEventListener('input', () => {
                    if (input.value.length > 0) {
                        this.validateField(input, ruleName);
                    }
                });

                // التحقق عند فقدان التركيز
                input.addEventListener('blur', () => {
                    this.validateField(input, ruleName);
                });

                // إعادة تعيين الحدود عند التركيز
                input.addEventListener('focus', () => {
                    if (input.style.border.includes('dc3545')) {
                        input.style.border = '2px solid #667eea';
                        input.style.boxShadow = '0 0 5px rgba(102, 126, 234, 0.3)';
                    }
                });
            }

            // التحقق عند الإرسال
            form.addEventListener('submit', (e) => {
                let isValid = true;
                
                for (const fieldId in rules) {
                    const input = document.getElementById(fieldId);
                    if (input && !this.validateField(input, rules[fieldId])) {
                        isValid = false;
                    }
                }

                if (!isValid) {
                    e.preventDefault();
                    this.beep('error');
                    this.speak('عفواً، يوجد بيانات خاطئة أو ناقصة');
                    
                    // عرض تنبيه
                    this.showToast('❌ يرجى تصحيح الأخطاء', 'error');
                }
            });
        },

        // عرض تنبيه Toast
        showToast: function(message, type) {
            let toast = document.getElementById('aiValidationToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'aiValidationToast';
                document.body.appendChild(toast);
            }

            toast.textContent = message;
            toast.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                padding: 15px 30px;
                border-radius: 10px;
                font-size: 16px;
                font-weight: bold;
                z-index: 999999;
                color: white;
                background: ${type === 'success' ? '#28a745' : '#dc3545'};
                box-shadow: 0 5px 20px rgba(0,0,0,0.3);
                opacity: 1;
                transition: opacity 0.5s;
            `;

            setTimeout(() => {
                toast.style.opacity = '0';
            }, 3000);
        }
    };

    // إضافة CSS للأنيميشن
    const style = document.createElement('style');
    style.textContent = `
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
        }
        @media print {
            .ai-validation-error, #aiValidationToast {
                display: none !important;
            }
        }
    `;
    document.head.appendChild(style);

    console.log('✅ AI Validation loaded');
})();
