// النواة الأساسية للمساعد الذكي - قاعدة المعرفة ومحرك البحث
(function() {
    'use strict';

    const AINLP = {
        stopWords: ['انا', 'عايز', 'اريد', 'لو', 'سمحت', 'ممكن', 'كيف', 'ازاي', 'فين', 'هل', 'من', 'في', 'على', 'عن', 'يا', 'لي', 'عشان', 'بدي', 'ودي', 'ابغى', 'ابي', 'طب'],
        
        normalizeText: function(text) {
            if (!text) return '';
            let normalized = text.toLowerCase().trim();
            normalized = normalized.replace(/[\u064B-\u065F]/g, ''); // إزالة التشكيل
            normalized = normalized.replace(/[أإآ]/g, 'ا');
            normalized = normalized.replace(/ة/g, 'ه');
            normalized = normalized.replace(/ى/g, 'ي');
            normalized = normalized.replace(/[؟?!.,؛،]/g, '');
            return normalized;
        },

        removeStopWords: function(text) {
            const words = text.split(/\s+/);
            const filtered = words.filter(word => !this.stopWords.includes(word));
            return filtered.join(' ');
        },

        calculateSimilarity: function(s1, s2) {
            if (!s1 || !s2) return 0;
            const costs = new Array();
            for (let i = 0; i <= s1.length; i++) {
                let lastValue = i;
                for (let j = 0; j <= s2.length; j++) {
                    if (i == 0) costs[j] = j;
                    else {
                        if (j > 0) {
                            let newValue = costs[j - 1];
                            if (s1.charAt(i - 1) != s2.charAt(j - 1))
                                newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                            costs[j - 1] = lastValue;
                            lastValue = newValue;
                        }
                    }
                }
                if (i > 0) costs[s2.length] = lastValue;
            }
            const distance = costs[s2.length];
            const maxLength = Math.max(s1.length, s2.length);
            return (maxLength - distance) / maxLength;
        },

        processInput: function(input) {
            const normalized = this.normalizeText(input);
            return this.removeStopWords(normalized);
        }
    };

    window.AICore = {
        // أنماط البحث في المنتجات - الكلمات اللي تعني ان المستخدم عايز يبحث عن منتج
        productSearchPatterns: [
            'ابحث عن منتج', 'دور على منتج', 'هات منتج', 'فين منتج', 'عايز منتج',
            'ابحث عن', 'البحث عن', 'بحث عن', 'دور على', 'هات لي', 'فين', 'عندك', 'عندنا',
            'سعر', 'سعر منتج', 'كام سعر', 'بكام', 'ثمن',
            'كمية', 'كمية منتج', 'كام قطعة', 'متوفر',
            'منتج اسمه', 'الصنف', 'صنف اسمه', 'المنتج', 'ابحس عن', 'بحس عن',
            'ابحث في المنتجات', 'دور في المنتجات', 'بحث منتجات',
            'search', 'find', 'product'
        ],

        // أنماط البحث في الصيدليات
        pharmacySearchPatterns: [
            'ابحث عن صيدلية', 'البحث عن صيدلية', 'بحث عن صيدلية', 'دور على صيدلية', 'فين صيدلية', 'عايز صيدلية',
            'صيدلية اسمها', 'صيدليه اسمها', 'صيدلية ', 'صيدليه ', 'عميل اسمه', 'عميل ', 'ابحث عن عميل', 'البحث عن عميل', 'بحث عن عميل', 'دور على عميل',
            'ابحث في الصيدليات', 'البحث في الصيدليات', 'دور في الصيدليات', 'بحث صيدليات'
        ],

        // --- إعدادات البيانات الضخمة (20,000+ منتج) ---
        worker: null,
        smartCache: new Map(), // تخزين أفضل 500 منتج للاستجابة اللحظية
        isWorkerReady: false,

        initWorker: function() {
            if (typeof Worker !== 'undefined' && !this.worker) {
                try {
                    this.worker = new Worker('ai-worker.js');
                    this.worker.onmessage = (e) => this.handleWorkerMessage(e);
                    this.isWorkerReady = true;
                    console.log('👷 AI Worker initialized for massive data support');
                } catch (err) {
                    console.error('❌ Failed to start AI Worker:', err);
                }
            }
        },

        handleWorkerMessage: function(e) {
            const { action, results, errors } = e.data;
            if (action === 'searchResult') {
                // تحديث الكاش بالنتائج الجديدة
                results.forEach(p => {
                    if (this.smartCache.size < 500) this.smartCache.set(p.productName, p);
                });
                if (this._searchCallback) this._searchCallback(results);
            }
            if (action === 'auditResult') {
                window._aiAuditResults = errors;
                console.log('🛡️ AI Background Audit Complete:', errors);
            }
        },

        // تنفيذ فحص دوري للمخزن بالكامل (20,000 صنف)
        runMassiveAudit: function(allProducts) {
            if (this.isWorkerReady) {
                this.worker.postMessage({ action: 'audit', products: allProducts });
            }
        },

        // --- قاعدة المعرفة الشاملة ---
        knowledgeBase: [
            {
                keys: ['ابحث عن منتج', 'محتاج منتج', 'دور على منتج', 'دور لي على منتج', 'عايز منتج', 'ابحث لي عن منتج', 'لو سمحت ابحث عن منتج', 'ايجاد منتج'],
                answer: 'يرجى كتابة اسم المنتج الذي تبحث عنه بوضوح.\nمثال: "ابحث عن بندول" أو "سعر الاسبرين"',
                action: () => { 
                    const input = document.getElementById('aiTextInput');
                    if (input) {
                        if(input.value === '') input.value = 'ابحث عن ';
                        input.focus();
                    }
                }
            },
            {
                keys: ['ابحث عن صيدلية', 'البحث عن صيدلية', 'بحث عن صيدلية', 'دور على صيدلية', 'فين صيدلية', 'عايز صيدلية', 'بحث صيدليات', 'ابحث في الصيدليات'],
                answer: 'يرجى كتابة اسم الصيدلية أو رقم هاتفها بوضوح.\nمثال: "صيدلية العزبي" أو "رقم 01012345678"',
                action: () => { 
                    const input = document.getElementById('aiTextInput');
                    if (input) {
                        if(input.value === '') input.value = 'صيدلية ';
                        input.focus();
                    }
                }
            },
            {
                keys: ['تسجيل', 'اشتراك', 'حساب جديد', 'انشاء حساب', 'مخزن جديد', 'ازاي اسجل', 'عايز اسجل', 'اعمل حساب'],
                answer: 'لتسجيل مخزن جديد: اذهب لصفحة التسجيل، أدخل اسم المخزن، ثم الإيميل، ثم الباسورد. تأكد أن رقم الهاتف 11 رقماً يبدأ بصفر. اضغط تسجيل وسيتم إنشاء حسابك فوراً.',
                action: () => { if (!location.href.includes('register')) location.href = 'register.html'; }
            },
            {
                keys: ['رقم هاتف', 'تليفون', '11 رقم', 'رقم غلط', 'رقم خطأ', 'موبايل', 'الرقم مش شغال'],
                answer: 'رقم الهاتف يجب أن يكون 11 رقماً بالضبط ويبدأ بصفر. مثال: 01012345678. إذا ظهر خطأ تأكد من عدد الأرقام.',
                action: null
            },
            {
                keys: ['اضافة منتج', 'منتج جديد', 'منتج واحد', 'اضف منتج', 'ازاي اضيف منتج', 'عايز اضيف صنف'],
                answer: 'لإضافة منتج واحد: اذهب لصفحة إضافة منتج، أدخل الاسم والسعر والخصم، اختر متوفر دائماً أو محدود الكمية، أدخل تاريخ الإنتاج والانتهاء، ثم اضغط إضافة.',
                action: () => { location.href = 'add-product.html'; }
            },
            {
                keys: ['منتجات جماعي', 'رفع منتجات', 'اكسل', 'excel', 'csv', 'ملايين', 'كتير', 'منتجات كتير', 'ادخال جماعي', 'رفع ملف'],
                answer: 'للإدخال الجماعي: اذهب لصفحة الإدخال الجماعي، ارفع ملف إكسل أو سي إس في، حدد الأعمدة المطابقة للاسم والسعر والكمية، ثم اضغط استيراد. يمكنك رفع ملايين المنتجات دفعة واحدة.',
                action: () => { location.href = 'bulk-add.html'; }
            },
            {
                keys: ['حذف منتج', 'مسح منتج', 'ازاي احذف', 'عايز امسح منتج', 'الغي منتج'],
                answer: 'لحذف منتج: اذهب لصفحة المنتجات، ابحث عن المنتج، اضغط زر حذف بجانبه وأكد الحذف. لحذف جميع المنتجات اضغط زر حذف جميع المنتجات.',
                action: () => { location.href = 'products.html'; }
            },
            {
                keys: ['مسح المخزن', 'حذف كل المنتجات', 'مسح كل شيء', 'امسح كل حاجة', 'احذف الكل'],
                answer: 'لمسح المخزن بالكامل: اذهب لصفحة المنتجات، اضغط زر حذف جميع المنتجات باللون الأحمر، أكد العملية. تنبيه: هذا الإجراء لا يمكن التراجع عنه.',
                action: () => { location.href = 'products.html'; }
            },
            {
                keys: ['تنبيه نفاذ', 'تنبيه كمية', 'حد التنبيه', 'low stock', 'الكمية خلصت', 'تنبيه المخزون'],
                answer: 'لضبط تنبيه نفاذ الكمية: اذهب لصفحة المنتجات، اضغط زر ضبط جماعي للتنبيه، أدخل الحد الأدنى للكمية، اضغط تطبيق على الكل. سيظهر تنبيه أحمر عند وصول الكمية لهذا الحد.',
                action: () => { location.href = 'products.html'; }
            },
            {
                keys: ['اضافة صيدلية', 'صيدلية جديدة', 'عميل جديد', 'اضف صيدلية', 'ازاي اضيف صيدلية', 'عايز اضيف عميل'],
                answer: 'لإضافة صيدلية: اذهب لصفحة الصيدليات، أدخل الاسم ورقم التليفون 11 رقماً والعنوان، يمكنك إضافة موقع جي بي إس اختيارياً، اضغط إضافة الصيدلية.',
                action: () => { location.href = 'pharmacies.html'; }
            },
            {
                keys: ['اوردر', 'طلب جديد', 'طلبية', 'عمل اوردر', 'انشاء اوردر', 'ازاي اعمل اوردر', 'عايز اعمل طلب'],
                answer: 'لعمل أوردر: اذهب لصفحة إنشاء الأوردر، اختر الصيدلية، أضف المنتجات والكميات، اختر موظف التحضير ورجل الدليفري، أضف ملاحظات إن وجدت، اضغط إنشاء الأوردر. يمكنك إرساله عبر واتساب مباشرة.',
                action: () => { location.href = 'create-order.html'; }
            },
            {
                keys: ['دليفري', 'توصيل', 'رجل دليفري', 'اضف دليفري', 'ازاي اضيف دليفري', 'عايز اضيف موصل'],
                answer: 'لإضافة رجل دليفري: اذهب لصفحة ملف المنتجات وانزل لقسم إدارة الدليفري، أدخل الاسم ورقم التليفون، اضغط إضافة. يمكنك أيضاً إضافة رقم موظف التحضير من نفس القسم.',
                action: () => { location.href = 'products.html'; }
            },
            {
                keys: ['طباعة', 'طبع', 'print', 'مشكلة طباعة', 'ازاي اطبع', 'عايز اطبع', 'الطباعة مش شغالة'],
                answer: 'لطباعة الأوردرات: اذهب لصفحة الأوردرات أو ملف الصيدلية، اضغط زر الطباعة بجانب الأوردر. لطباعة المنتجات: اذهب لصفحة المنتجات واضغط زر طباعة. تأكد من إعدادات الطابعة.',
                action: null
            },
            {
                keys: ['واتساب', 'whatsapp', 'ارسال', 'ارسل', 'ازاي ابعت', 'عايز ابعت واتساب', 'الواتساب مش شغال'],
                answer: 'لإرسال الأوردر عبر واتساب: بعد إنشاء الأوردر اضغط زر إرسال واتساب. سيفتح واتساب تلقائياً مع تفاصيل الأوردر لموظف التحضير ورجل الدليفري.',
                action: null
            },
            {
                keys: ['تسجيل دخول', 'دخول', 'لوجن', 'login', 'ازاي ادخل', 'عايز ادخل', 'مش عارف ادخل'],
                answer: 'لتسجيل الدخول: أدخل الإيميل والباسورد. إذا كنت موظفاً أدخل إيميل المدير وباسوردك الخاص. إذا نسيت الباسورد تواصل مع المدير.',
                action: () => { location.href = 'login.html'; }
            },
            {
                keys: ['مساعدة', 'ساعدني', 'help', 'ايه اللي تعرفه', 'ايه اللي تقدر', 'انت بتعمل ايه', 'محتاج مساعدة'],
                answer: 'أنا المساعد الذكي لنظام إدارة المخازن. أعرف كل شيء عن: التسجيل، إضافة المنتجات فردياً وجماعياً، إدارة الصيدليات، عمل الأوردرات، إدارة الموظفين والدليفري، الطباعة، والبحث. يمكنك أيضاً البحث عن أي منتج بكتابة "ابحث عن" متبوعاً باسم المنتج!',
                action: null
            },
            {
                keys: ['كام منتج', 'عدد المنتجات', 'احصائيات', 'احصائيات المنتجات', 'ملخص المنتجات', 'كام صنف'],
                answer: null, // سيتم تعبئتها ديناميكياً
                isDynamic: true,
                dynamicType: 'productStats'
            }
        ],

        // ===== البحث الذكي في المنتجات =====

        // استخراج كلمة البحث من الجملة
        extractSearchTerm: function(input, patterns) {
            let cleanInput = input.toLowerCase().trim();
            
            // ترتيب الأنماط من الأطول للأقصر لتجنب التطابق الجزئي
            const sortedPatterns = patterns.slice().sort((a, b) => b.length - a.length);
            
            for (const pattern of sortedPatterns) {
                const idx = cleanInput.indexOf(pattern.toLowerCase());
                if (idx !== -1) {
                    // استخراج ما بعد النمط
                    let searchTerm = cleanInput.substring(idx + pattern.length).trim();
                    // إزالة علامات الاستفهام
                    searchTerm = searchTerm.replace(/[؟?!.]/g, '').trim();
                    if (searchTerm.length >= 1) {
                        return searchTerm;
                    } else {
                        return null; // لا ترجع 'الكل'، بل ترجع null ليتم الرد من قاعدة المعرفة
                    }
                }
            }
            return null;
        },

        // التحقق هل المدخل يطلب بحث في المنتجات
        isProductSearch: function(input) {
            const lower = input.toLowerCase().trim();
            for (const pattern of this.productSearchPatterns) {
                if (lower.includes(pattern.toLowerCase())) {
                    return true;
                }
            }
            return false;
        },

        // التحقق هل المدخل يطلب بحث في الصيدليات
        isPharmacySearch: function(input) {
            const lower = input.toLowerCase().trim();
            for (const pattern of this.pharmacySearchPatterns) {
                if (lower.includes(pattern.toLowerCase())) {
                    return true;
                }
            }
            return false;
        },

        // البحث الفعلي في المنتجات باستخدام AIDatabase (المعدل لدعم 20,000+ صنف)
        searchInProducts: function(searchTerm) {
            try {
                const q = searchTerm.toLowerCase().trim();
                
                // 1. البحث في الذاكرة الذكية (Smart Cache) للاستجابة اللحظية
                const cacheResults = [];
                this.smartCache.forEach((p, name) => {
                    if (name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))) {
                        cacheResults.push({
                            ...p,
                            relevance: name.toLowerCase().startsWith(q) ? 100 : 50
                        });
                    }
                });

                // 2. إطلاق البحث العميق في الخلفية (Worker) إذا كان متاحاً
                if (this.isWorkerReady) {
                    // جلب كل المنتجات من الـ localStorage أو IndexedDB لإرسالها للـ Worker
                    // ملاحظة: في بيئة الإنتاج الحقيقية، نرسل فقط التغييرات أو نستخدم SharedArrayBuffer
                    const allProducts = JSON.parse(localStorage.getItem('products')) || [];
                    this._latestSearchQuery = q;
                    this.worker.postMessage({ action: 'search', query: q, products: allProducts });
                }

                if (cacheResults.length > 0) {
                    cacheResults.sort((a, b) => b.relevance - a.relevance);
                    return { results: cacheResults.slice(0, 10), total: cacheResults.length, source: 'cache' };
                }

                // 3. Fallback: البحث التقليدي (لأول مرة قبل امتلاء الكاش)
                if (window.AIDatabase && typeof window.AIDatabase.searchProducts === 'function') {
                    const results = window.AIDatabase.searchProducts(searchTerm, 10);
                    return { results: results, total: results.length, source: 'database' };
                } else {
                    const currentUser = JSON.parse(sessionStorage.getItem('currentUser'));
                    if (!currentUser) return { results: [], total: 0, error: 'لم يتم تسجيل الدخول' };

                    const allProducts = JSON.parse(localStorage.getItem('products')) || [];
                    const userProducts = allProducts.filter(p => p.userId === currentUser.email);
                    
                    const results = [];
                    for (const product of userProducts) {
                        const name = (product.productName || product.name || '').toLowerCase();
                        if (name.includes(q) || (product.barcode && product.barcode.includes(q))) {
                            results.push({
                                ...product,
                                relevance: name.startsWith(q) ? 10 : 5
                            });
                        }
                    }

                    results.sort((a, b) => b.relevance - a.relevance);
                    return { results: results.slice(0, 10), total: results.length, source: 'local' };
                }
            } catch (e) {
                console.error('AI Search Error:', e);
                return { results: [], total: 0, error: 'حدث خطأ أثناء البحث' };
            }
        },

        // البحث الفعلي في الصيدليات
        searchInPharmacies: function(searchTerm) {
            try {
                if (window.AIDatabase && typeof window.AIDatabase.searchPharmacies === 'function') {
                    const results = window.AIDatabase.searchPharmacies(searchTerm, 10);
                    return { results: results, total: results.length };
                } else {
                    const currentUser = JSON.parse(sessionStorage.getItem('currentUser'));
                    if (!currentUser) return { results: [], total: 0, error: 'لم يتم تسجيل الدخول' };

                const allPharmacies = JSON.parse(localStorage.getItem('pharmacies')) || [];
                const userPharmacies = allPharmacies.filter(p => p.odbyId === currentUser.email || p.userId === currentUser.email);
                
                if (userPharmacies.length === 0) {
                    return { results: [], total: 0, error: 'لا توجد صيدليات مسجلة' };
                }

                const q = searchTerm.toLowerCase().trim();
                const results = [];

                for (const pharmacy of userPharmacies) {
                    const name = (pharmacy.name || '').toLowerCase();
                    const phone = (pharmacy.phone || '').toLowerCase();
                    const address = (pharmacy.address || '').toLowerCase();
                    
                    if (name.includes(q) || phone.includes(q) || address.includes(q)) {
                        results.push(pharmacy);
                    }
                }

                return { results: results.slice(0, 10), total: results.length };
                }
            } catch (e) {
                console.error('خطأ في البحث:', e);
                return { results: [], total: 0, error: 'حدث خطأ أثناء البحث' };
            }
        },

        // تنسيق نتائج البحث في المنتجات كنص HTML
        formatProductResults: function(searchData, searchTerm, isOrderPage) {
            if (searchData.error) {
                return '⚠️ ' + searchData.error;
            }

            if (searchData.results.length === 0) {
                return '❌ عذراً، المنتج المحتوي على "' + searchTerm + '" <strong>غير متوفر</strong> في المخزن حالياً.<br><br>💡 تأكد من كتابة الاسم بشكل صحيح أو جرب البحث بجزء من الاسم.';
            }

            let response = '<strong>🔍 نتائج البحث عن "' + searchTerm + '":</strong><br>';
            response += '<small>📊 تم العثور على ' + searchData.total + ' منتج</small>';
            if (searchData.total > 10) response += ' <small>(عرض أول 10)</small>';
            response += '<hr style="border-top: 1px solid #ccc; margin: 8px 0;">';

            searchData.results.forEach((p, i) => {
                const name = p.productName || p.name || 'بدون اسم';
                const price = p.price ? p.price.toFixed(2) : '0.00';
                const discount = p.discount || 0;
                const afterDiscount = p.price ? (p.price - (p.price * discount / 100)).toFixed(2) : '0.00';
                const quantity = p.isUnlimited ? '♾️ متوفر دائماً' : ('📦 ' + (p.quantity || 0) + ' قطعة');
                
                response += '<div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee;">';
                response += '<strong>' + (i + 1) + '. 💊 ' + name + '</strong><br>';
                response += '<span style="color: #2e7d32;">💰 ' + price + ' جنيه</span>';
                if (discount > 0) {
                    response += ' | <span style="color: #c62828;">خصم ' + discount + '% → <strong>' + afterDiscount + ' جنيه</strong></span>';
                }
                response += '<br><span>' + quantity + '</span>';
                
                if (p.expiryDate) {
                    const expiry = new Date(p.expiryDate);
                    const now = new Date();
                    if (expiry <= now) {
                        response += '<br><span style="color: #d32f2f;">⛔ منتهي الصلاحية!</span>';
                    } else {
                        const threeMonths = new Date();
                        threeMonths.setMonth(now.getMonth() + 3);
                        if (expiry <= threeMonths) {
                            response += '<br><span style="color: #f57c00;">⚠️ قرب انتهاء الصلاحية: ' + p.expiryDate + '</span>';
                        } else {
                            response += '<br><span style="color: #1976d2;">📅 الانتهاء: ' + p.expiryDate + '</span>';
                        }
                    }
                }
                
                if (p.lowStockAlert && !p.isUnlimited && p.quantity <= p.lowStockAlert) {
                    response += '<br><span style="color: #d32f2f;">🔴 تنبيه: الكمية منخفضة!</span>';
                }
                
                // إضافة رابط تحرير أو عرض المنتج
                if (isOrderPage) {
                    const safeName = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    response += '<br><button onclick="document.getElementById(\'searchInput\').value=\'' + safeName + '\'; document.getElementById(\'searchInput\').dispatchEvent(new Event(\'input\', {bubbles:true})); if(window.AIUI) window.AIUI.close();" style="margin-top: 5px; padding: 4px 8px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">➕ فلترة لإضافته للأوردر</button>';
                } else {
                    response += '<br><button onclick="location.href=\'products.html?search=' + encodeURIComponent(name) + '\'" style="margin-top: 5px; padding: 4px 8px; background: #2196f3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">🔍 عرض المنتجات</button>';
                }
                
                response += '</div>';
            });

            return response;
        },

        // تنسيق نتائج البحث في الصيدليات
        formatPharmacyResults: function(searchData, searchTerm) {
            if (searchData.error) {
                return '⚠️ ' + searchData.error;
            }

            if (searchData.results.length === 0) {
                return '❌ عذراً، لا توجد صيدلية ببيانات مطابقة لـ "' + searchTerm + '" مسجلة حالياً.<br><br>💡 تأكد من كتابة الاسم أو رقم التليفون بشكل صحيح.';
            }

            let response = '<strong>🔍 نتائج البحث عن الصيدليات المطابقة لـ "' + searchTerm + '":</strong><br>';
            response += '<small>📊 تم العثور على ' + searchData.total + ' صيدلية</small>';
            if (searchData.total > 10) response += ' <small>(عرض أول 10)</small>';
            response += '<hr style="border-top: 1px solid #ccc; margin: 8px 0;">';

            searchData.results.forEach((p, i) => {
                const name = p.name || p.pharmacyName || 'بدون اسم';
                const phone = p.phone || p.pharmacyPhone || 'بدون رقم';
                const address = p.address || p.pharmacyAddress || 'بدون عنوان';
                
                response += '<div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee;">';
                response += '<strong>' + (i + 1) + '. 🏥 ' + name + '</strong><br>';
                response += '<span style="color: #1976d2;">📱 ' + phone + '</span><br>';
                response += '<span style="color: #616161;">📍 ' + address + '</span>';
                
                response += '<br><button onclick="location.href=\'pharmacies.html?search=' + encodeURIComponent(name) + '\'" style="margin-top: 5px; padding: 4px 8px; background: #4facfe; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">🔍 عرض الصيدلية</button>';
                
                response += '</div>';
            });

            return response;
        },

        // إحصائيات المنتجات
        getProductStats: function() {
            try {
                const currentUser = JSON.parse(sessionStorage.getItem('currentUser'));
                if (!currentUser) return 'يجب تسجيل الدخول أولاً لعرض الإحصائيات.';

                const allProducts = JSON.parse(localStorage.getItem('products')) || [];
                const userProducts = allProducts.filter(p => p.userId === currentUser.email);
                
                if (userProducts.length === 0) {
                    return '📊 المخزن فارغ حالياً. لا توجد منتجات مضافة.\n\nيمكنك إضافة منتجات من صفحة إضافة المنتجات.';
                }

                const total = userProducts.length;
                const unlimited = userProducts.filter(p => p.isUnlimited).length;
                const limited = total - unlimited;
                
                const today = new Date();
                const threeMonths = new Date();
                threeMonths.setMonth(today.getMonth() + 3);
                const expiring = userProducts.filter(p => {
                    if (!p.expiryDate) return false;
                    const exp = new Date(p.expiryDate);
                    return exp <= threeMonths && exp >= today;
                }).length;

                const lowStock = userProducts.filter(p => {
                    return !p.isUnlimited && p.lowStockAlert && p.quantity <= p.lowStockAlert;
                }).length;

                let stats = '📊 إحصائيات المخزن:\n\n';
                stats += '📦 إجمالي المنتجات: ' + total + '\n';
                stats += '♾️ متوفر دائماً: ' + unlimited + '\n';
                stats += '🔢 كمية محدودة: ' + limited + '\n';
                if (expiring > 0) stats += '⚠️ قرب انتهاء الصلاحية: ' + expiring + '\n';
                if (lowStock > 0) stats += '🔴 كمية منخفضة: ' + lowStock + '\n';

                return stats;
            } catch (e) {
                return 'حدث خطأ في تحميل الإحصائيات.';
            }
        },

        // محرك استخراج الإجراءات (Action Engine - Entity Extraction)
        extractActionData: function(input) {
            // وحدة معالجة الأرقام العربية والعامية المتطورة
            const parseSlangNumbers = (text) => {
                const map = {
                    'صفر': 0, 'واحد': 1, 'واحدة': 1, 'اتنين': 2, 'اثنين': 2, 'تلاتة': 3, 'تلاته': 3, 'ثلاثة': 3, 'اربعة': 4, 'اربعه': 4, 'خمسة': 5, 'خمسه': 5, 'ستة': 6, 'سته': 6, 'سبعة': 7, 'سبعه': 7, 'تمانية': 8, 'تمنية': 8, 'تمانيه': 8, 'تسعة': 9, 'تسعه': 9,
                    'عشرة': 10, 'عشره': 10, 'حداشر': 11, 'اتناشر': 12, 'تلاتاشر': 13, 'اربعتاشر': 14, 'خمستاشر': 15, 'خمستاسر': 15, 'ستاشر': 16, 'سبعتاشر': 17, 'تمنتاشر': 18, 'تسعتاشر': 19,
                    'عشرين': 20, 'تلاتين': 30, 'ثلاثين': 30, 'اربعين': 40, 'خمسين': 50, 'ستين': 60, 'سبعين': 70, 'تمانين': 80, 'تسعين': 90,
                    'مية': 100, 'مائة': 100, 'ميتين': 200, 'تلتمية': 300, 'ربعمية': 400, 'خمسمية': 500, 'ستمية': 600, 'سبعمية': 700, 'تمنمية': 800, 'تسعمية': 900, 'الف': 1000,
                    'نص': 0.5, 'ربع': 0.25, 'دستة': 12, 'دستتين': 24
                };
                
                let words = text.split(/\s+/);
                let resultWords = [];
                let i = 0;
                
                while (i < words.length) {
                    let word = words[i];
                    
                    // التعامل مع الكسور المركبة (ونص، وربع، وتلات ربع)
                    if (word === 'ونص') {
                        if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number') {
                            resultWords[resultWords.length-1] += 0.5;
                            i++; continue;
                        }
                        // التعامل مع "نص دستة"
                        if (i + 1 < words.length && words[i+1] === 'دستة') {
                            resultWords.push(6);
                            i += 2; continue;
                        }
                    }
                    if (word === 'وربع') {
                        if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number') {
                            resultWords[resultWords.length-1] += 0.25;
                            i++; continue;
                        }
                        // التعامل مع "ربع دستة"
                        if (i + 1 < words.length && words[i+1] === 'دستة') {
                            resultWords.push(3);
                            i += 2; continue;
                        }
                    }
                    if (word === 'وتلات' && i + 1 < words.length && words[i+1] === 'ربع') {
                        if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number') {
                            resultWords[resultWords.length-1] += 0.75;
                            i += 2; continue;
                        }
                    }
                    if (word === 'تلات' && i + 1 < words.length && words[i+1] === 'ربع') {
                        resultWords.push(0.75);
                        i += 2; continue;
                    }

                    // التعامل مع "الا ربع" (مثل: خمسة الا ربع -> 4.75)
                    if (word === 'الا' && i + 1 < words.length && words[i+1] === 'ربع') {
                        if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number') {
                            resultWords[resultWords.length-1] -= 0.25;
                            i += 2; continue;
                        }
                    }

                    // التعامل مع "من مية" أو "قرش" (مثل: خمسة وسبعين من مية)
                    if (word === 'من' && i + 1 < words.length && words[i+1] === 'مية') {
                        if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number') {
                            let last = resultWords.pop();
                            // إزالة حرف "و" إذا وجد قبله لتسهيل الدمج العشري
                            if (resultWords.length > 0 && (resultWords[resultWords.length-1] === 'و' || resultWords[resultWords.length-1] === 'و ')) {
                                resultWords.pop();
                            }
                            if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number') {
                                resultWords[resultWords.length-1] += (last / 100);
                            } else {
                                resultWords.push(last / 100);
                            }
                            i += 2; continue;
                        }
                    }

                    if (word === 'قرش' || word === 'قروش' || word === 'ساغ') {
                        if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number') {
                            let last = resultWords.pop();
                            // إزالة حرف "و" إذا وجد قبله لتسهيل الدمج العشري
                            if (resultWords.length > 0 && (resultWords[resultWords.length-1] === 'و' || resultWords[resultWords.length-1] === 'و ')) {
                                resultWords.pop();
                            }
                            if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number') {
                                resultWords[resultWords.length-1] += (last / 100);
                            } else {
                                resultWords.push(last / 100);
                            }
                            i++; continue;
                        }
                    }

                    // دعم الفكة المصرية القديمة والدارجة (بريزة، شلن)
                    if (word === 'بريزة' || word === 'برايز') {
                        let amount = (word === 'بريزة') ? 0.10 : 0.10;
                        if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number' && word === 'برايز') {
                            let last = resultWords[resultWords.length-1];
                            resultWords[resultWords.length-1] = last * 0.10;
                        } else {
                            resultWords.push(amount);
                        }
                        i++; continue;
                    }
                    if (word === 'شلن' || word === 'اشلان') {
                        let amount = (word === 'شلن') ? 0.05 : 0.05;
                        if (resultWords.length > 0 && typeof resultWords[resultWords.length-1] === 'number' && word === 'اشلان') {
                            let last = resultWords[resultWords.length-1];
                            resultWords[resultWords.length-1] = last * 0.05;
                        } else {
                            resultWords.push(amount);
                        }
                        i++; continue;
                    }

                    let currentNum = map[word];
                    
                    if (currentNum !== undefined) {
                        // محاولة دمج الوحدات مع العشرات (مثل: خمسة وعشرين)
                        if (i + 2 < words.length && (words[i+1] === 'و' || words[i+1] === 'و ') && map[words[i+2]] !== undefined) {
                            let nextNum = map[words[i+2]];
                            // إذا كان الأول آحاد والثاني عشرات (خمسة وعشرين)
                            if (currentNum < 10 && nextNum >= 20 && nextNum < 100) {
                                resultWords.push(currentNum + nextNum);
                                i += 3;
                                continue;
                            }
                            // إذا كان الأول مئات والثاني آحاد/عشرات (مية وخمسة)
                            if (currentNum >= 100 && nextNum < 100) {
                                resultWords.push(currentNum + nextNum);
                                i += 3;
                                continue;
                            }
                        }
                        resultWords.push(currentNum);
                    } else {
                        resultWords.push(word);
                    }
                    i++;
                }
                return resultWords.map(w => w.toString()).join(' ');
            };

            input = parseSlangNumbers(input);

            const result = { type: null, data: {} };
            const isOrderPage = typeof window !== 'undefined' && window.location.href.toLowerCase().includes('create-order');
            const isAddProductPage = typeof window !== 'undefined' && window.location.href.toLowerCase().includes('add-product');

            // 1. أولوية التحقق لنية "إضافة منتج للأوردر"
            const orderAddPattern = /(?:اوردر|أوردر|إوردر|طلب|الطلب|للطلب|فاتور[ةه])/i;
            const actionWordPattern = /(?:ضيف|حط|زود|نزل|[إاأ]?ض[اي]ف[ةه]?|[إاأ]?ضف|هات|إضافة|اضافة|ادخال|إدخال|دخل|سجله)/i;
            
            // إذا كان المستخدم في صفحة الأوردر، نعتبر أي فعل إضافة موجهاً للأوردر حتى بدون ذكر كلمة "أوردر"
            const shouldTriggerOrderAction = (orderAddPattern.test(input) && actionWordPattern.test(input)) || (isOrderPage && actionWordPattern.test(input));

            if (shouldTriggerOrderAction) {
                result.type = 'addToOrder';
                
                const qtyMatch = input.match(/(\d+)/);
                result.data.quantity = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                
                // Enhanced name cleaning for medicines
                let name = input.replace(/(ضيف|حط|زود|نزل|اضف|إضف|أضف|اضيف|اضافة|إضافة|ادخال|إدخال|دخل|هات|سجله|للاوردر|للأوردر|اوردر|أوردر|إوردر|الاوردر|الأوردر|الطلب|طلب|للطلب|في|على|لـ|ع|علبة|علب|شريط|شرايط|قطعة|قطع|كبسولة|كبسولات|كبسول|حبة|حبات|من|منتج|منتجات|المنتج|المنتجات)/gi, ' ');
                name = name.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
                name = name.replace(/^[وب]\s*/, '').trim();
                
                result.data.productName = name;
                console.log('🤖 AI Extracted (Order):', result.data);
                return result;
            }

            // 1.1 دعم الإدخال السريع في صفحة الأوردر (كمية + اسم) بدون كلمات أمر
            if (isOrderPage) {
                const qtyMatch = input.match(/(\d+)/);
                if (qtyMatch) {
                    const foundQty = parseInt(qtyMatch[1]);
                    let potentialName = input.replace(/\d+/g, ' ');
                    potentialName = potentialName.replace(/(علبة|علب|شريط|شرايط|قطعة|قطع|كبسولة|كبسولات|كبسول|حبة|حبات|من|وب|و|يا|لو|سمحت|ممكن)/gi, ' ').trim();
                    
                    if (potentialName.length >= 2) {
                        result.type = 'addToOrder';
                        result.data.quantity = foundQty;
                        result.data.productName = potentialName;
                        console.log('🤖 AI Extracted (Flexible Shorthand):', result.data);
                        return result;
                    }
                }
            }

            // 2. التحقق من نية "إنشاء منتج جديد" أو إدخال بيانات منتج
            const createPattern = /(ضيف\s*منتج|منتج\s*جديد|[إاأ]?ض[اي]ف[ةه]?\s*منتج|[إاأ]?ضف\s*منتج|إضافة\s*منتج|اضافة\s*منتج|ادخال\s*منتج|إدخال\s*منتج|سجل\s*منتج)/i;
            
            const priceRegex = /(\d+(?:\.\d+)?)\s*(?:جني[هة]|قني[هة]|ج)/;
            const priceMatch = input.match(/(?:سعر[هها]?|بكام|بـ|ب|تمن[هها]?|عامله|واقف\s*بـ|بتاع)\s*(\d+(?:\.\d+)?)/) || input.match(priceRegex);
            
            const percentRegex = /(\d+(?:\.\d+)?)\s*(?:%|٪|بالم[يى][هة]|ف[يى]\s*الم[يى][هة]|بالمائ[ةه]|ف[يى]\s*المائ[ةه])/;
            const discountMatch = input.match(/(?:خصم[هها]?)\s*(\d+(?:\.\d+)?)/) || input.match(percentRegex);
            
            const dateRegex = /(\d{1,2})[/\-.\s]+(\d{1,2})[/\-.\s]+(\d{2,4})/g;
            const foundDates = [];
            let dMatch;
            while ((dMatch = dateRegex.exec(input)) !== null) {
                let d = dMatch[1].padStart(2, '0');
                let m = dMatch[2].padStart(2, '0');
                let y = dMatch[3];
                if (y.length === 2) y = "20" + y;
                const dd = parseInt(d);
                const mm = parseInt(m);
                if (dd > 0 && dd <= 31 && mm > 0 && mm <= 12) {
                    foundDates.push(`${y}-${m}-${d}`);
                }
            }

            const hasEntities = priceMatch || discountMatch || foundDates.length > 0;
            const isIntentionalCreate = createPattern.test(input) || (isAddProductPage && hasEntities);

            if (isIntentionalCreate) {
                result.type = 'createProduct';
                
                if (priceMatch) {
                    result.data.price = priceMatch[1] || priceMatch[0].match(/\d+(?:\.\d+)?/)[0];
                }
                
                if (discountMatch) {
                    result.data.discount = discountMatch[1] || discountMatch[0].match(/\d+(?:\.\d+)?/)[0];
                }
                
                const qtyMatch = input.match(/(?:كمي[تة][هها]?|الكمي[ةه]|عدد)\s*(\d+)/) || input.match(/\s(\d+)\s*(علب|علبة|شريط|قطعة)/) || input.match(/^(\d+)\s/);
                if (qtyMatch) result.data.quantity = qtyMatch[1];
                
                if (foundDates.length >= 2) {
                    let d1 = foundDates[0];
                    let d2 = foundDates[1];
                    if (new Date(d1) > new Date(d2)) {
                        result.data.productionDate = d2;
                        result.data.expiryDate = d1;
                        result.data.datesAutoSwapped = true;
                    } else {
                        result.data.productionDate = d1;
                        result.data.expiryDate = d2;
                    }
                } else if (foundDates.length === 1) {
                    result.data.expiryDate = foundDates[0];
                }
                
                let namePart = input;
                const stops = [
                    /(?:سعر[هها]?|بكام|بـ|تمن[هها]?|عامله|واقف\s*بـ|بتاع)\s*\d+/, 
                    priceRegex,
                    /(?:خصم[هها]?)\s*\d+/, 
                    percentRegex,
                    /(?:كمي[تة][هها]?|الكمي[ةه]|عدد)\s*\d+/,
                    /(\d{1,2})[/\-.\s]+(\d{1,2})[/\-.\s]+(\d{2,4})/
                ];
                stops.forEach(pattern => {
                    const match = namePart.match(pattern);
                    if (match && match.index !== undefined) {
                        namePart = namePart.substring(0, match.index);
                    }
                });
                
                namePart = namePart.replace(/(ضيف|[إاأ]?ض[اي]ف[ةه]?|[إاأ]?ضف|إضافة|اضافة|ادخال|إدخال|دخل|سجل|منتج|جديد|اسم[هها]?|سعر[هها]?|تمن[هها]?|عامله|واقف\s*بـ|بتاع|جني[هة]|قني[هة]|ج|%|٪|بالم[يى][هة]|ف[يى]\s*الم[يى][هة]|بالمائ[ةه]|ف[يى]\s*المائ[ةه]|\d{1,2}[/\-.\s]+\d{1,2}[/\-.\s]+\d{2,4})/gi, ' ');
                if (qtyMatch && input.startsWith(qtyMatch[1])) {
                    namePart = namePart.replace(new RegExp('^' + qtyMatch[1]), '');
                }
                namePart = namePart.replace(/\s+/g, ' ').trim();
                namePart = namePart.replace(/^[وب]\s*/, '').trim();
                
                result.data.productName = namePart;
                result.validation = this.checkLogicalErrors(result.data);
                return result;
            }

            // 3. دعم الإدخال السريع والمختصر في صفحة "إضافة منتج" (الكمية + الاسم)
            if (isAddProductPage) {
                // نمط: رقم ثم نص أو نص ثم رقم
                const qtyMatch = input.match(/(\d+)/);
                if (qtyMatch) {
                    const foundQty = parseInt(qtyMatch[1]);
                    let potentialName = input.replace(/\d+/g, ' ');
                    potentialName = potentialName.replace(/(علبة|علب|شريط|قطعة|قطع|كبسولة|كبسول|حبة|حبات|من|وب|و|يا|لو|سمحت|ممكن)/gi, ' ').trim();
                    
                    if (potentialName.length >= 2) {
                        result.type = 'createProduct';
                        result.data.quantity = foundQty;
                        result.data.productName = potentialName;
                        console.log('🤖 AI Extracted (AddProduct Shorthand):', result.data);
                        return result;
                    }
                }
            }

            return result;
        },

        // محلل الأخطاء المنطقية والحلول المقترحة
        checkLogicalErrors: function(data) {
            const errors = [];
            
            // 1. فقدان اسم المنتج
            if (!data.productName || data.productName.length < 2) {
                errors.push({
                    type: 'MISSING_NAME',
                    message: 'لم أستطع تحديد اسم المنتج. يرجى ذكر الاسم بوضوح.',
                    solution: 'حاول قول: "أضف بنادول بسعر 50"'
                });
            }

            // 2. تضارب التواريخ (الشك في الترتيب والمحاولة في التصحيح التلقائي)
            if (data.datesAutoSwapped) {
                errors.push({
                    type: 'DATE_AUTO_FIXED',
                    message: 'تم تبديل تاريخ الإنتاج والانتهاء تلقائياً لأن الترتيب كان معكوساً.',
                    solution: 'تم تصحيح البيانات لترسلها للصفحة بشكل سليم.'
                });
            } else if (data.productionDate && data.expiryDate) {
                const pDate = new Date(data.productionDate);
                const eDate = new Date(data.expiryDate);
                if (eDate < pDate) {
                    errors.push({
                        type: 'SWAPPED_DATES',
                        message: 'تاريخ الانتهاء يسبق تاريخ الإنتاج. يرجى مراجعة التواريخ.',
                        solution: 'يرجى ذكر التاريخ الصحيح أو كتابته يدوياً.'
                    });
                }
            }

            // 3. سعر مبالغ فيه (نظام حماية)
            if (data.price && parseFloat(data.price) > 10000) {
                errors.push({
                    type: 'SUSPICIOUS_PRICE',
                    message: `السعر المذكور (${data.price}) يبدو مرتفعاً جداً بالنسبة لصنف واحد.`,
                    solution: 'يرجى التأكد من الرقم وإعادة المحاولة إذا كان خطأ.'
                });
            }

            // 4. نقص في البيانات الأساسية (تحذير وليس خطأ)
            if (!data.price && !data.quantity) {
                errors.push({
                    type: 'INCOMPLETE_DATA',
                    message: 'تم التعرف على الاسم، لكن لم يتم ذكر السعر أو الكمية.',
                    solution: 'يمكنك إكمال البيانات يدوياً أو قول الجملة كاملة.'
                });
            }

            // 5. تاريخ منتهي الصلاحية
            if (data.expiryDate) {
                const now = new Date();
                const exp = new Date(data.expiryDate);
                if (exp < now) {
                    errors.push({
                        type: 'EXPIRED',
                        message: `⚠️ <strong>تنبيه:</strong> الصنف ده منتهي الصلاحية (${data.expiryDate})!`,
                        solution: 'اتأكد من التاريخ لو سمحت قبل الإكمال.'
                    });
                }
            }

            return errors;
        },

        // حالة الجلسة الحالية (للمتابعة الاستفسارية)
        session: {
            isActive: false,
            type: null, // مثلاً createProduct
            data: {},
            nextField: null,
            missingFields: []
        },

        // محرك البحث الذكي المحسّن (المعدل لدعم الجلسات والعمليات الجماعية)
        findAnswer: function(input) {
            input = input.toLowerCase().trim();
            const cleanInput = input.replace(/[؟?!.,؛،]/g, '');

            // 0. التحقق إذا كانت هناك جلسة نشطة للمتابعة
            if (this.session.isActive) {
                return this.processSessionInput(cleanInput);
            }

            // 0.1 فحص العمليات الجماعية (Multi-Product Bulk Entry)
            // البحث عن أدوات الربط (و - ثم - ،) لتقسيم الجملة
            const connectors = [" و ", " ثم ", " , ", "،"];
            let segments = [cleanInput];
            
            // محاولة التقسيم إذا وجد أكثر من منتج (بناءً على تكرار كلمات مفتاحية مثل "أضف" أو "سعر")
            if (cleanInput.split(/و|ثم|،/).length > 1 && (cleanInput.includes("أضف") || cleanInput.includes("سعر"))) {
                segments = cleanInput.split(/ و | ثم | ،/).map(s => s.trim()).filter(s => s.length > 2);
            }

            if (segments.length > 1) {
                const results = [];
                segments.forEach(seg => {
                    const res = this.extractActionData(seg);
                    if (res.type === 'createProduct' && res.data.productName) {
                        results.push(res);
                    }
                });

                if (results.length > 1) {
                    // معالجة النتيجة الجماعية
                    let htmlSummary = `<div style="background: #e7f3ff; padding: 12px; border-radius: 10px; border-right: 4px solid #007bff; margin-bottom: 10px;">`;
                    htmlSummary += `<strong>📦 اكتشفت ${results.length} أصناف في جملتك:</strong><ul style="margin: 8px 0; padding-right: 20px;">`;
                    
                    let bulkUrl = 'bulk-add.html?source=ai';
                    results.forEach((r, idx) => {
                        htmlSummary += `<li>${r.data.productName} (كمية: ${r.data.quantity || 1})</li>`;
                        // بناء رابط الإضافة الجماعية الأساسي (يمكن توسيعه)
                        bulkUrl += `&n${idx}=${encodeURIComponent(r.data.productName)}&q${idx}=${r.data.quantity || 1}`;
                    });
                    htmlSummary += `</ul></div>`;

                    return {
                        answer: htmlSummary + `هل تريد مراجعة هذه الأصناف وإضافتها للمخزن دفعة واحدة؟`,
                        action: () => { location.href = bulkUrl; },
                        actionText: `📝 مراجعة وحفظ ${results.length} أصناف`,
                        isHtml: true,
                        voiceSummary: `فهمت إنك عايز تضيف ${results.length} أصناف، تحب أراجعهم معاك؟`
                    };
                }
            }

            // 0.2 التحقق من النوايا الإجرائية (Action Intents: إضافة منتج، إضافة للأوردر)
            const actionIntent = this.extractActionData(cleanInput);
            
            // 0.2 معالجة تنبيهات التحقق وبدء جلسة إذا لزم الأمر
            if (actionIntent.type === 'createProduct') {
                const missingFields = [];
                if (!actionIntent.data.productName) missingFields.push('name');
                if (!actionIntent.data.price) missingFields.push('price');
                if (!actionIntent.data.quantity) missingFields.push('quantity');
                if (!actionIntent.data.discount) missingFields.push('discount');
                if (!actionIntent.data.expiryDate) missingFields.push('expiryDate');

                // ذكاء اصطناعي مرن: إذا كانت البيانات "كافية" (اسم + تاريخ + سعر أو كمية)، لا نبدأ جلسة متابعة
                const hasSufficientData = actionIntent.data.productName && 
                                          actionIntent.data.expiryDate && 
                                          (actionIntent.data.price || actionIntent.data.quantity);

                if (!hasSufficientData && actionIntent.data.productName) {
                    this.session = {
                        isActive: true,
                        type: 'createProduct',
                        data: actionIntent.data,
                        nextField: missingFields.find(f => f !== 'name'),
                        missingFields: missingFields.filter(f => f !== 'name')
                    };
                    return this.generateFollowUpQuestion();
                }

                // عرض التنبيهات ونظام التحذير الاستباقي
                let validationHeader = '';
                let validationVoice = '';
                if (actionIntent.validation && actionIntent.validation.length > 0) {
                    const criticalError = actionIntent.validation.find(e => e.type === 'MISSING_NAME');
                    if (criticalError) {
                        return {
                            answer: `⚠️ <strong>عذراً:</strong> ${criticalError.message}<br><br><small>💡 الحل: ${criticalError.solution}</small>`,
                            isHtml: true,
                            voiceSummary: criticalError.message
                        };
                    }
                    
                    validationHeader = `<div style="background: #fff3cd; padding: 10px; border-radius: 8px; margin-bottom: 10px; border-right: 4px solid #ffc107; font-size: 13px;">`;
                    actionIntent.validation.forEach(err => {
                        validationHeader += `<strong>• ${err.message}</strong><br>💡 ${err.solution}<br>`;
                        if (err.type === 'SWAPPED_DATES') validationVoice = 'تنبيه: تاريخ الانتهاء قبل الإنتاج.';
                        if (err.type === 'DATE_AUTO_FIXED') validationVoice = 'تم تبديل التواريخ تلقائياً.';
                    });
                    validationHeader += `</div>`;
                }

                let url = 'add-product.html?name=' + encodeURIComponent(actionIntent.data.productName);
                if (actionIntent.data.price) url += '&price=' + actionIntent.data.price;
                if (actionIntent.data.discount) url += '&discount=' + actionIntent.data.discount;
                if (actionIntent.data.productionDate) url += '&prodDate=' + actionIntent.data.productionDate;
                if (actionIntent.data.expiryDate) url += '&expDate=' + actionIntent.data.expiryDate;
                
                const isAddProductPage = typeof window !== 'undefined' && window.location.href.toLowerCase().includes('add-product');
                
                // إذا كنا بالفعل في صفحة إضافة منتج، قم بتعبئة الحقول مباشرة
                if (isAddProductPage && typeof window.fillProductFields === 'function') {
                    // تعبئة الحقول مباشرة
                    setTimeout(() => {
                        window.fillProductFields(actionIntent.data);
                    }, 500);
                    
                    return {
                        answer: validationHeader + `📝 جاري تعبئة بيانات <strong>${actionIntent.data.productName}</strong> بكمية ${actionIntent.data.quantity || 'غير محددة'}...`,
                        action: null, // لا حاجة للانتقال
                        actionText: null,
                        isSearch: false,
                        isHtml: true,
                        voiceSummary: validationVoice || `جاري تعبئة بيانات ${actionIntent.data.productName}`
                    };
                }
                
                return {
                    answer: validationHeader + `✅ جاري تجهيز صفحة إضافة المنتج <strong>${actionIntent.data.productName}</strong> مع تعبئة البيانات لتراجعها وتعتمدها...`,
                    action: () => { location.href = url; },
                    actionText: '📝 الذهاب وحفظ المنتج',
                    isSearch: false,
                    isHtml: true,
                    voiceSummary: validationVoice || 'اضغط للذهاب لصفحة إضافة المنتج'
                };
            }
            
            if (actionIntent.type === 'addToOrder' && actionIntent.data.productName && actionIntent.data.productName.length >= 2) {
                const searchData = this.searchInProducts(actionIntent.data.productName);
                const isOrderPage = typeof window !== 'undefined' && window.location.href.toLowerCase().includes('create-order');
                
                // البحث عن منتج بنتيجة ثقة معقولة (أكثر من 40)
                if (searchData.results.length > 0 && searchData.results[0].relevance >= 40) {
                    const exactProduct = searchData.results[0];
                    const exactName = exactProduct.productName || exactProduct.name;
                    
                    if (isOrderPage) {
                        const addToOrderAction = () => {
                            console.log('🤖 AI: Attempting to add product to order:', exactName);
                            
                            // محاولة الوصول لـ setQty و cart بأي وسيلة (توجيه مباشر للـ window)
                            const setQtyFunc = window.setQty;
                            
                            if (typeof setQtyFunc === 'function') {
                                const current = (window.cart && window.cart[exactName]) ? window.cart[exactName] : 0;
                                const newQty = current + actionIntent.data.quantity;
                                
                                console.log(`🤖 AI: Calling setQty('${exactName}', ${newQty})`);
                                const res = setQtyFunc(exactName, newQty);
                                
                                if (res && res.success) {
                                    // التحقق مما إذا كانت الكمية المضافة أقل من المطلوبة بسبب النقص في المخزن
                                    const diff = res.actualQty - (window.cart[exactName] ? (window.cart[exactName] - res.actualQty) : 0); 
                                    // ملاحظة: res.actualQty هي الكمية الإجمالية في السلة الآن
                                    // لنحسب الكمية التي "أضيفت فعلياً" في هذه الخطوة
                                    const addedNow = res.actualQty - current;
                                    
                                    let feedbackText = 'تمت إضافة ' + addedNow + ' من ' + exactName;
                                    if (addedNow < actionIntent.data.quantity) {
                                        feedbackText = `⚠️ الكمية المتاحة فقط ${addedNow}. تم إضافة المتاح من ${exactName}`;
                                    } else if (addedNow === 0 && actionIntent.data.quantity > 0) {
                                        feedbackText = `❌ عذراً، ${exactName} غير متوفر حالياً بالمخزن.`;
                                    }

                                    // عرض المنتج في الجدول ليعرف المستخدم أن شيئاً قد حدث
                                    const searchInput = document.getElementById('searchInput');
                                    if(searchInput) {
                                        searchInput.value = exactName;
                                        searchInput.dispatchEvent(new Event('input', {bubbles: true}));
                                    }

                                    // نطق الإضافة باستخدام المحرك الموحد
                                    if(window.AISpeech) {
                                        window.AISpeech.speak(feedbackText);
                                    }
                                    
                                    // تنبيه بيب (إذا وجد)
                                    if(window.AIValidation && window.AIValidation.beep) {
                                        window.AIValidation.beep(addedNow > 0 ? 'success' : 'error');
                                    }
                                    
                                    console.log('✅ AI Action Executed Successfully:', feedbackText);
                                    return true;
                                } else {
                                    console.error('❌ AI Action: window.setQty failed', res);
                                }
                            } else {
                                console.error('❌ AI Action Failed: window.setQty is not a function');
                                // محاولة بديلة: الفلترة فقط
                                const searchInput = document.getElementById('searchInput');
                                if(searchInput) {
                                    searchInput.value = exactName;
                                    searchInput.dispatchEvent(new Event('input', {bubbles: true}));
                                }
                            }
                            return false;
                        };

                        return {
                            answer: `✅ تم العثور على <strong>${exactName}</strong>.<br>جاري إضافة ${actionIntent.data.quantity} قطعة للأوردر الحالي...`,
                            action: addToOrderAction,
                            immediateAction: addToOrderAction, // للتنفيذ التلقائي بدون ضغط الزر
                            actionText: `➕ تأكيد إدراج ${actionIntent.data.quantity} قطع`,
                            isSearch: false,
                            isHtml: true,
                            voiceSummary: `تم إدراج ${actionIntent.data.quantity} قطع من ${exactName}`
                        };
                    } else {
                        return {
                            answer: `ليتم إضافة <strong>${exactName}</strong> للأوردر، يجب الانتقال لصفحة أوردر المبيعات أولاً.`,
                            action: () => { location.href = 'create-order.html?add=' + encodeURIComponent(exactName) + '&qty=' + actionIntent.data.quantity; },
                            actionText: '🛒 الذهاب وإنشاء الأوردر',
                            isSearch: false,
                            isHtml: true,
                            voiceSummary: 'اضغط للذهاب لصفحة الأوردر'
                        };
                    }
                } else {
                    // لم يتم العثور على المنتج أو نتيجة البحث ضعيفة جداً
                    console.warn('⚠️ AI Search: No sufficiently matching product found for', actionIntent.data.productName);
                    return {
                        answer: `عذراً، المنتج "<strong>${actionIntent.data.productName}</strong>" غير موجود في قائمة المنتجات المحفوظة. يرجى إضافة المنتج أولاً لتتمكن من إدراجه في الأوردر.`,
                        isSearch: false,
                        isHtml: true,
                        voiceSummary: `المنتج ${actionIntent.data.productName} غير متوفر، يرجى إضافته للمخزن أولاً`
                    };
                }
            }

            // 1. فحص هل المستخدم يريد البحث في الصيدليات
            if (this.isPharmacySearch(cleanInput)) {
                const searchTerm = this.extractSearchTerm(cleanInput, this.pharmacySearchPatterns);
                if (searchTerm) {
                    const searchData = this.searchInPharmacies(searchTerm);
                    return {
                        answer: this.formatPharmacyResults(searchData, searchTerm),
                        action: searchData.results.length > 0 ? () => { location.href = 'pharmacies.html?search=' + encodeURIComponent(searchTerm); } : null,
                        isSearch: true,
                        searchType: 'pharmacy',
                        isHtml: true,
                        voiceSummary: searchData.results.length > 0 ? 'هذه هي الصيدليات المطابقة لبحثك' : 'الصيدلية غير متوفرة'
                    };
                }
            }

            // 2. فحص هل المستخدم يريد البحث في المنتجات
            if (this.isProductSearch(cleanInput)) {
                const searchTerm = this.extractSearchTerm(cleanInput, this.productSearchPatterns);
                if (searchTerm) {
                    const searchData = this.searchInProducts(searchTerm);
                    const isOrderPage = typeof window !== 'undefined' && window.location.href.toLowerCase().includes('create-order.html');

                    return {
                        answer: this.formatProductResults(searchData, searchTerm, isOrderPage),
                        action: searchData.results.length > 0 
                            ? () => {
                                  if (isOrderPage) {
                                      const input = document.getElementById('searchInput');
                                      if (input) {
                                          input.value = searchTerm;
                                          input.dispatchEvent(new Event('input', {bubbles: true}));
                                      }
                                  } else {
                                      location.href = 'products.html?search=' + encodeURIComponent(searchTerm);
                                  }
                              } 
                            : null,
                        actionText: isOrderPage ? '➕ تصفية المنتجات في الطلب' : null,
                        isSearch: true,
                        searchType: 'product',
                        isHtml: true,
                        voiceSummary: searchData.results.length > 0 ? 'هذه هي المنتجات المطابقة لبحثك' : 'المنتج غير متوفر'
                    };
                }
            }

            // 3. البحث العادي في قاعدة المعرفة (مدعوم بمحرك NLP)
            let bestMatch = null;
            let topScore = 0;
            const nlpInput = AINLP.processInput(input);
            const inputWords = nlpInput.split(' ').filter(w => w.trim().length > 0);
            
            for (const item of this.knowledgeBase) {
                let score = 0;
                
                for (const keyword of item.keys) {
                    const nlpKey = AINLP.processInput(keyword);
                    const keyWords = nlpKey.split(' ').filter(w => w.trim().length > 0);
                    
                    // تطابق كامل بعد المعالجة (أفضل تقييم)
                    if (nlpInput.includes(nlpKey) || nlpKey.includes(nlpInput)) {
                        score += 50;
                    }
                    
                    // تطابق جزئي بالكلمات مع حساب التشابه الجذري (Levenshtein) للتعامل مع الأخطاء الإملائية
                    for (const inputWord of inputWords) {
                        if (inputWord.length >= 2) {
                            for (const keyWord of keyWords) {
                                if (keyWord.length >= 2) {
                                    const sim = AINLP.calculateSimilarity(inputWord, keyWord);
                                    if (sim === 1.0) {
                                        score += 15; // تطابق حرفي ممتاز
                                    } else if (sim >= 0.8) {
                                        score += 8; // خطأ في حرف واحد تقريبا
                                    } else if (sim >= 0.6) {
                                        score += 3; // تشابه جزئي
                                    }
                                }
                            }
                        }
                    }
                }
                
                if (score > topScore) {
                    topScore = score;
                    bestMatch = item;
                }
            }
            
            // معالجة العناصر الديناميكية
            if (bestMatch && bestMatch.isDynamic) {
                if (bestMatch.dynamicType === 'productStats') {
                    return {
                        answer: this.getProductStats(),
                        action: () => { location.href = 'products.html'; },
                        isSearch: false
                    };
                }
            }

            if (topScore >= 5) {
                return bestMatch;
            }

            // 4. Fallback Context-Aware Search (If no match at all, assume they just typed the item name on relevant pages)
            if (typeof window !== 'undefined') {
                const currentHref = window.location.href.toLowerCase();
                const isOrderPage = currentHref.includes('create-order.html');
                const isProductPage = currentHref.includes('products.html');
                const isPharmacyPage = currentHref.includes('pharmacies.html');

                if (isOrderPage || isProductPage) {
                    const searchData = this.searchInProducts(cleanInput);
                    return {
                        answer: this.formatProductResults(searchData, cleanInput, isOrderPage),
                        action: searchData.results.length > 0 
                            ? () => {
                                  if (isOrderPage) {
                                      const input = document.getElementById('searchInput');
                                      if (input) {
                                          input.value = cleanInput;
                                          input.dispatchEvent(new Event('input', {bubbles: true}));
                                      }
                                  } else {
                                      location.href = 'products.html?search=' + encodeURIComponent(cleanInput);
                                  }
                            }
                            : null,
                        actionText: isOrderPage ? '➕ تصفية المنتجات في الطلب' : null,
                        isSearch: true,
                        searchType: 'product',
                        isHtml: true,
                        voiceSummary: searchData.results.length > 0 ? 'هذه هي المنتجات المطابقة لبحثك' : 'المنتج غير متوفر'
                    };
                } else if (isPharmacyPage) {
                    const searchData = this.searchInPharmacies(cleanInput);
                    return {
                        answer: this.formatPharmacyResults(searchData, cleanInput),
                        action: searchData.results.length > 0 
                            ? () => { location.href = 'pharmacies.html?search=' + encodeURIComponent(cleanInput); }
                            : null,
                        isSearch: true,
                        searchType: 'pharmacy',
                        isHtml: true,
                        voiceSummary: searchData.results.length > 0 ? 'هذه هي الصيدليات المطابقة لبحثك' : 'الصيدلية غير متوفرة'
                    };
                }
            }

            return null;
        },

        // معالجة مدخلات الجلسة النشطة
        processSessionInput: function(input) {
            const field = this.session.nextField;
            const data = this.extractActionData(input);
            
            // التحقق من طلب الإلغاء
            if (/(إلغي|إلغاء|خلاص|توقف|إيقاف|قفل|انهاء|cancel|stop)/i.test(input)) {
                const name = this.session.data.productName;
                this.session.isActive = false;
                return { 
                    answer: `❌ تم إلغاء متابعة إضافة <strong>${name}</strong>.`,
                    isHtml: true,
                    voiceSummary: `تم إلغاء العملية.`
                };
            }

            // استخراج القيمة المناسبة للحقل الحالي
            let valueFound = false;
            if (field === 'price' && (data.data.price || !isNaN(parseFloat(input.match(/\d+/))))) {
                this.session.data.price = data.data.price || input.match(/\d+/)[0];
                valueFound = true;
            } else if (field === 'quantity' && (data.data.quantity || !isNaN(parseFloat(input.match(/\d+/))))) {
                this.session.data.quantity = data.data.quantity || input.match(/\d+/)[0];
                valueFound = true;
            } else if (field === 'discount' && (data.data.discount || !isNaN(parseFloat(input.match(/\d+/))))) {
                this.session.data.discount = data.data.discount || input.match(/\d+/)[0];
                valueFound = true;
            } else if (field === 'expiryDate' && (data.data.expiryDate || input.match(/\d{1,2}[/\-.\s]+\d{1,2}[/\-.\s]+\d{2,4}/))) {
                this.session.data.expiryDate = data.data.expiryDate || input;
                valueFound = true;
            }

            if (valueFound) {
                // الانتقال للحقل التالي
                this.session.missingFields = this.session.missingFields.filter(f => f !== field);
                if (this.session.missingFields.length > 0) {
                    this.session.nextField = this.session.missingFields[0];
                    return this.generateFollowUpQuestion(true);
                } else {
                    // اكتمال الجلسة
                    const finalData = this.session.data;
                    this.session.isActive = false;
                    
                    let url = 'add-product.html?name=' + encodeURIComponent(finalData.productName);
                    if (finalData.price) url += '&price=' + finalData.price;
                    if (finalData.quantity) url += '&qty=' + finalData.quantity;
                    if (finalData.discount) url += '&discount=' + finalData.discount;
                    if (finalData.expiryDate) url += '&expDate=' + finalData.expiryDate;

                    return {
                        answer: `✅ ممتاز! بيانات <strong>${finalData.productName}</strong> أصبحت كاملة الآن:<br>• السعر: ${finalData.price || '0'}<br>• الكمية: ${finalData.quantity || '1'}<br>• الخصم: ${finalData.discount || '0'}%<br>• الانتهاء: ${finalData.expiryDate || '-'}`,
                        action: () => { location.href = url; },
                        actionText: '📝 حفظ المنتج الآن',
                        isHtml: true,
                        voiceSummary: `بيانات ${finalData.productName} جاهزة للحفظ.`
                    };
                }
            } else {
                return {
                    answer: `عذراً، لم أفهم القيمة. يرجى إدخال ${this.getFieldLabel(field)} لـ <strong>${this.session.data.productName}</strong> أو قول "خلاص" للإلغاء.`,
                    isHtml: true,
                    voiceSummary: `لم أفهم، من فضلك قولي ${this.getFieldLabel(field)}`
                };
            }
        },

        // توليد سؤال المتابعة التالي بالعامية المصرية
        generateFollowUpQuestion: function(isIntermediate = false) {
            const field = this.session.nextField;
            const name = this.session.data.productName;
            
            const questions = {
                'price': [
                    `تمام، سعر <strong>${name}</strong> كام؟`,
                    `جميل، وواقف بـ كام <strong>${name}</strong>؟`,
                    `تمام، قولي سعره كام؟`
                ],
                'quantity': [
                    `وعندك منه كمية قد إيه؟`,
                    `تمام، والعدد اللي موجود كام <strong>${name}</strong>؟`,
                    `ماشي، قولي الكمية اللي عندك؟`
                ],
                'discount': [
                    `وعليه خصم كام في المية؟`,
                    `تمام، والخصم بتاعه قد إيه؟`,
                    `ماشي، ونازل عليه خصم كام؟`
                ],
                'expiryDate': [
                    `وآخر حاجة، ميعاد انتهاؤه امتى؟`,
                    `تمام، وتاريخ الأكسبير بتاعه كام؟`,
                    `جميل، والانتهاء بتاعه امتى؟`
                ]
            };

            const randomQ = questions[field][Math.floor(Math.random() * questions[field].length)];
            const prefix = isIntermediate ? "جميل، " : "";

            return {
                answer: prefix + randomQ,
                isHtml: true,
                voiceSummary: randomQ.replace(/<\/?strong>/g, '')
            };
        },

        getFieldLabel: function(field) {
            const labels = { 'price': 'السعر', 'quantity': 'الكمية', 'discount': 'الخصم', 'expiryDate': 'تاريخ الانتهاء' };
            return labels[field] || field;
        },

        // الحصول على نصيحة استباقية حسب الصفحة
        getProactiveAdvice: function(page) {
            const pageLower = page.toLowerCase();
            if (pageLower.includes('add-product')) {
                return {
                    answer: "👋 <strong>أهلاً بك!</strong> شايف إنك بتضيف صنف جديد. متاح ليك تستخدم صوتك لإدخال كل البيانات مرة واحدة أو تسألني عن أي حاجة.",
                    voice: "أهلاً بك، أنا بتابع معاك إضافة الصنف الجديد، لو محتاج مساعدة قولي"
                };
            }
            if (pageLower.includes('create-order')) {
                return {
                    answer: "🛒 <strong>جاهز لعمل أوردر؟</strong> قولي اسم المنتج والكمية وأنا هضيفهم لك فوراً في السلة وأتأكد من المخزون.",
                    voice: "أقدر أساعدك تعمل الأوردر بسرعة، قولي أسماء الأصناف اللي محتاجها"
                };
            }
            if (pageLower.includes('limited-products')) {
                return {
                    answer: "⚠️ <strong>نواقص المخزن!</strong> الأصناف دي قربت تخلص، تحب أساعدك تعمل طلب شراء جديد؟",
                    voice: "خد بالك في أصناف قربت تخلص من المخزن"
                };
            }
            if (pageLower.includes('bulk-add') || pageLower.includes('bulk-add-products') || 
                pageLower.includes('bulk-entry') || pageLower.includes('mass-add')) {
                return {
                    answer: "📊 <strong>إدخال جماعي!</strong> أنا هنا لمساعدتك في إدخال المنتجات بشكل جماعي. سأراقب البيانات وأنبهك لأي أخطاء أو مشاكل.",
                    voice: "أهلاً بك في صفحة الإدخال الجماعي، أنا هراقب البيانات وأنبهك لأي أخطاء"
                };
            }
            return null;
        },

        // فحص مدخلات الصفحة فوراً واكتشاف الأخطاء
        validatePageInputs: function(fields) {
            const warnings = [];
            
            // 1. فحص اسم المنتج الفارغ
            if (fields.productName !== undefined) {
                const name = fields.productName?.trim();
                if (!name || name.length < 2) {
                    warnings.push({
                        field: 'productName',
                        message: '📝 <strong>ملاحظة:</strong> يجب إدخال اسم المنتج (حرفين على الأقل).',
                        voice: 'من فضلك أدخل اسم المنتج'
                    });
                } else if (name.length > 100) {
                    warnings.push({
                        field: 'productName',
                        message: '⚠️ <strong>تنبيه:</strong> اسم المنتج طويل جداً (أكثر من 100 حرف).',
                        voice: 'اسم المنتج طويل جداً، حاول اختصاره'
                    });
                }
            }

            // 2. فحص الكمية
            if (fields.quantity !== undefined) {
                const qty = parseFloat(fields.quantity);
                if (isNaN(qty) || qty < 0) {
                    warnings.push({
                        field: 'quantity',
                        message: '❌ <strong>خطأ:</strong> الكمية يجب أن تكون رقماً موجباً.',
                        voice: 'الكمية خطأ، أدخل رقماً موجباً'
                    });
                } else if (qty > 1000000) {
                    warnings.push({
                        field: 'quantity',
                        message: '🧐 <strong>تنبيه:</strong> الكمية كبيرة جداً (> مليون قطعة). تأكد من الرقم.',
                        voice: 'الكمية كبيرة جداً، تأكد من الرقم'
                    });
                }
            }

            // 3. فحص الخصم
            if (fields.discount !== undefined) {
                const discount = parseFloat(fields.discount);
                if (isNaN(discount) || discount < 0) {
                    warnings.push({
                        field: 'discount',
                        message: '❌ <strong>خطأ:</strong> الخصم يجب أن يكون رقماً موجباً.',
                        voice: 'الخصم خطأ، أدخل رقماً موجباً'
                    });
                } else if (discount > 100) {
                    warnings.push({
                        field: 'discount',
                        message: '⚠️ <strong>تنبيه:</strong> الخصم لا يمكن أن يتجاوز 100%.',
                        voice: 'الخصم لا يمكن أن يتجاوز مئة في المية'
                    });
                }
            }

            // 4. فحص الباركود
            if (fields.barcode !== undefined) {
                const barcode = fields.barcode?.trim();
                if (barcode && barcode.length > 0 && barcode.length < 8) {
                    warnings.push({
                        field: 'barcode',
                        message: '📊 <strong>ملاحظة:</strong> الباركود قصير جداً (عادة 8-13 رقماً).',
                        voice: 'الباركود قصير، تأكد من الرقم'
                    });
                }
            }

            // 5. فحص تواريخ الانتهاء
            if (fields.expiryYear && fields.expiryMonth) {
                const now = new Date();
                const currentMonth = now.getMonth() + 1;
                const currentYear = now.getFullYear();
                
                const expYear = parseInt(fields.expiryYear);
                const expMonth = parseInt(fields.expiryMonth);
                
                if (isNaN(expYear) || isNaN(expMonth)) {
                    warnings.push({
                        field: 'expiry',
                        message: '❌ <strong>خطأ:</strong> التاريخ المدخل غير صحيح.',
                        voice: 'التاريخ خطأ، أدخل تاريخاً صحيحاً'
                    });
                } else if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
                    warnings.push({
                        field: 'expiry',
                        message: '⚠️ <strong>تنبيه:</strong> التاريخ ده منتهي الصلاحية!',
                        voice: 'خد بالك، التاريخ اللي دخلته منتهي الصلاحية'
                    });
                } else if (expYear === currentYear && expMonth <= currentMonth + 3) {
                    warnings.push({
                        field: 'expiry',
                        message: '🔔 <strong>ملحوظة:</strong> الصنف ده هيخلص صلاحيته كمان أقل من 3 شهور.',
                        voice: 'الصنف ده قرب ينتهي، صلاحيته أقل من تلات شهور'
                    });
                }
            }

            // 6. فحص الأسعار الصفرية أو المبالغ فيها
            if (fields.price !== undefined) {
                const price = parseFloat(fields.price);
                if (isNaN(price) || price < 0) {
                    warnings.push({
                        field: 'price',
                        message: '❌ <strong>خطأ:</strong> السعر يجب أن يكون رقماً موجباً.',
                        voice: 'السعر خطأ، أدخل رقماً موجباً'
                    });
                } else if (price === 0) {
                    warnings.push({
                        field: 'price',
                        message: '❓ <strong>السعر صفر؟</strong> جرب تتأكد من السعر قبل الحفظ.',
                        voice: 'إنت نسيت تحط السعر؟ السعر طالع بصفر'
                    });
                } else if (price > 10000) {
                    warnings.push({
                        field: 'price',
                        message: '🧐 <strong>تأكيد السعر:</strong> هل أنت متأكد من السعر ده؟ ستاشر ألف جنيه كتير شوية على صنف واحد.',
                        voice: 'السعر ده كبير جداً، اتأكد منه لو سمحت'
                    });
                }
            }

            return warnings;
        },

        // --- محرك التوافق الشامل للملفات (Universal File Compatibility) ---
        
        // قاموس مرادفات الصناعة الصيدلية
        pharmacySynonyms: {
            productName: ['اسم المنتج', 'اسم الصنف', 'الصنف', 'المنتج', 'اسم الدواء', 'item name', 'product name', 'description', 'medicine name', 'صنف', 'الاسم', 'الاسم التجارى', 'البيان', 'اسم المادة', 'Medicine', 'Drug', 'اسم الدواء/الصنف'],
            price: ['السعر', 'سعر الجمهور', 'سعر البيع', 'ثمن', 'سعر المستهلك', 'price', 'public price', 'selling price', 'rate', 'unit price', 'تمن', 'السعر للجمهور', 'سعر العلبة', 'Consumer Price', 'سعر'],
            discount: ['خصم', 'نسبة الخصم', 'الخصم', 'تخفيض', 'discount', 'disc%', 'discount rate', 'الخصوووم', 'تخفيض %'],
            quantity: ['الكمية', 'كمية', 'رصيد', 'المخزون', 'الرصيد المتاح', 'عدد', 'quantity', 'qty', 'stock', 'available', 'balance', 'count', 'رصيدك', 'الرصيد الحالى', 'الكمية المتاحة', 'العلب', 'Stock Qty', 'الكمية الحالية'],
            expiryDate: ['تاريخ الانتهاء', 'تاريخ الصلاحية', 'انتهاء', 'صلاحية', 'تاريخ النفاذ', 'expiry date', 'exp date', 'expir', 'valid until', 'التاريخ', 'اكسباير', 'نهاية الصلاحية', 'Expiry', 'Valid To', 'تاريخ الصلاحيه', 'الصلاحية'],
            productionDate: ['تاريخ الإنتاج', 'تاريخ الصنع', 'الإنتاج', 'صنع في', 'production date', 'mfg date', 'mfd', 'prod date', 'تاريخ الانتاج'],
            barcode: ['باركود', 'كود الصنف', 'كود', 'رقم المنتج', 'barcode', 'code', 'item code', 'ean', 'upc', 'باركود الصنف', 'الباركود']
        },

        // بصمات البرامج الشهيرة
        softwareSignatures: [
            { name: 'Vertex', headers: ['item name', 'public price', 'quantity'] },
            { name: 'PharmaSystem', headers: ['اسم الصنف', 'سعر الجمهور', 'الرصيد الحالي'] },
            { name: 'Al-Manar', headers: ['اسم الدواء', 'سعر البيع', 'رصيد المخزن'] },
            { name: 'QuickCloud', headers: ['product', 'price', 'stock'] }
        ],

        // الخرائط الذكية للأعمدة
        // محرك اللصق الذكي (Smart Paste Engine)
        smartParsePaste: function(text) {
            if (!text) return null;
            
            const result = {
                productName: '',
                price: null,
                quantity: null,
                discount: 0,
                expiryDate: null,
                barcode: null
            };

            // 1. تنظيف النص وتقسيمه
            let cleanText = text.trim();
            
            // 2. استخراج التاريخ (بحث عن نمط التاريخ)
            const datePatterns = [
                /\d{4}-\d{1,2}-\d{1,2}/,  // 2024-01-01
                /\d{1,2}\/\d{1,2}\/\d{4}/,  // 01/01/2024
                /\d{1,2}\/\d{2,4}/,         // 01/2026 or 01/26
                /\d{1,2}-\d{2,4}/           // 01-2026
            ];
            
            for (let pattern of datePatterns) {
                const match = cleanText.match(pattern);
                if (match) {
                    result.expiryDate = match[0];
                    cleanText = cleanText.replace(match[0], ' ');
                    break;
                }
            }

            // 3. استخراج الباركود (رقم طويل 8-14 رقم)
            const barcodeMatch = cleanText.match(/\d{8,14}/);
            if (barcodeMatch) {
                result.barcode = barcodeMatch[0];
                cleanText = cleanText.replace(barcodeMatch[0], ' ');
            }

            // 4. تقسيم ما تبقى من النص
            const parts = cleanText.split(/[\s,;|\t]+/).filter(p => p.trim());
            const numbers = [];
            const words = [];

            parts.forEach(part => {
                const num = parseFloat(part);
                if (!isNaN(num) && /^\d+(\.\d+)?$/.test(part)) {
                    numbers.push(num);
                } else {
                    words.push(part);
                }
            });

            // 5. تعيين الاسم (الكلمات المتبقية)
            result.productName = words.join(' ').trim();

            // 6. تعيين الأرقام (السعر والكمية والخصم)
            // السعر عادة يكون فيه فواصل عشرية أو هو الرقم الأكبر
            if (numbers.length > 0) {
                // ترتيب الأرقام: السعر عادة أكبر من الكمية في الأدوية
                // أو إذا وجدنا رقم عشري فهو السعر
                const decimalNum = numbers.find(n => n.toString().includes('.'));
                if (decimalNum) {
                    result.price = decimalNum;
                    numbers.splice(numbers.indexOf(decimalNum), 1);
                } else {
                    // نأخذ أكبر رقم كالسعر (افتراض صيدلاني)
                    const max = Math.max(...numbers);
                    result.price = max;
                    numbers.splice(numbers.indexOf(max), 1);
                }
            }

            if (numbers.length > 0) {
                // الرقم التالي هو الكمية
                result.quantity = numbers[0];
                numbers.shift();
            }

            if (numbers.length > 0) {
                // الرقم الثالث هو الخصم
                result.discount = numbers[0];
            }

            return result;
        },

        smartMapHeaders: function(headers) {
            const map = { productName: -1, price: -1, discount: -1, quantity: -1, productionDate: -1, expiryDate: -1, barcode: -1 };
            const detectedSoftware = { name: 'ملف مخصص', confidence: 0 };

            headers.forEach((header, index) => {
                if (!header) return;
                const h = header.toString().toLowerCase().trim();
                
                // البحث في قاموس المرادفات
                for (const [key, synonyms] of Object.entries(this.pharmacySynonyms)) {
                    if (synonyms.some(syn => h.includes(syn.toLowerCase()) || syn.toLowerCase().includes(h))) {
                        // إذا كان هناك تطابق بالفعل، نأخذ الأقرب (مثلاً "الاسم" أهم من "الاسم العلمي")
                        if (map[key] === -1 || synonyms.some(syn => syn.toLowerCase() === h)) {
                            map[key] = index;
                        }
                    }
                }
            });

            // الكشف عن البرنامج
            this.softwareSignatures.forEach(sig => {
                let matches = 0;
                sig.headers.forEach(sh => {
                    if (headers.some(h => h && h.toString().toLowerCase().includes(sh))) matches++;
                });
                const confidence = matches / sig.headers.length;
                if (confidence > detectedSoftware.confidence) {
                    detectedSoftware.name = sig.name;
                    detectedSoftware.confidence = confidence;
                }
            });

            return { map, software: detectedSoftware };
        }
    };

    console.log('✅ AI Core loaded - مع البحث في المنتجات والصيدليات');
})();
