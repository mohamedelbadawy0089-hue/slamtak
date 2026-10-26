// نظام ربط قاعدة البيانات المتطور (IndexedDB) - Database & Search (20,000+ Scalable)
(function() {
    'use strict';

    window.AIDatabase = {
        db: null,
        dbName: 'SalamtakDB',
        dbVersion: 6,

        async init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('products')) {
                        const store = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
                        store.createIndex('name', 'productName', { unique: false });
                        store.createIndex('barcode', 'barcode', { unique: false });
                        store.createIndex('expiry', 'expiryDate', { unique: false });
                        store.createIndex('userId', 'userId', { unique: false });
                    }
                };

                request.onsuccess = async (e) => {
                    this.db = e.target.result;
                    console.log('✅ IndexedDB Initialized');
                    await this.migrateLocalStorage();
                    resolve(this.db);
                };

                request.onerror = (e) => reject(e);
            });
        },

        // هجرة البيانات من LocalStorage إلى IndexedDB (لمرة واحدة)
        async migrateLocalStorage() {
            try {
                const products = JSON.parse(localStorage.getItem('products')) || [];
                
                // التحقق من وجود مخزن المنتجات
                if (!this.db || !this.db.objectStoreNames.contains('products')) {
                    console.warn('⚠️ مخزن المنتجات غير موجود، تخطي الهجرة...');
                    return;
                }
                
                if (products.length > 0) {
                    console.log('📦 Migrating products to IndexedDB...');
                    const transaction = this.db.transaction(['products'], 'readwrite');
                    const store = transaction.objectStore('products');
                    
                    // التأكد من عدم تكرار المنتجات في Migration بسيط
                    for (const p of products) {
                        store.put(p);
                    }
                    
                    transaction.oncomplete = () => {
                        console.log('✅ Migration Complete. Clearing localStorage...');
                        localStorage.removeItem('products');
                    };
                    
                    transaction.onerror = (e) => {
                        console.warn('⚠️ خطأ في الهجرة:', e);
                    };
                }
            } catch (error) {
                console.warn('⚠️ خطأ في migrateLocalStorage:', error);
            }
        },

        // بحث سريع (Sync fallback for UI)
        searchProducts: function(query, limit = 50) {
           // هذا الجزء سيستخدم الآن AICore مع الـ Worker للبحث العميق
           // ولكن نوفر واجهة توافقية
           if (window.AICore) return window.AICore.searchInProducts(query);
           return { results: [], total: 0 };
        },

        async addProduct(product) {
            try {
                // التحقق من وجود مستخدم مسجل الدخول
                const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser'));
                const currentWarehouseId = window.currentWarehouseId || (currentUser && currentUser.warehouseId);
                
                if (!currentUser || !currentUser.id) {
                    console.error('❌ لا يمكن إضافة المنتج: لا يوجد مستخدم مسجل الدخول');
                    return false;
                }
                
                // إضافة معلومات المستخدم للمنتج
                product.userId = currentUser.id;
                product.userEmail = currentUser.email;
                product.warehouseId = currentWarehouseId || currentUser.id;
                product.createdAt = new Date().toISOString();
                product.dbVersion = 6; // ربط المنتج بإصدار قاعدة البيانات
                
                console.log(`💾 إضافة منتج للمستخدم: ${currentUser.email} (${currentUser.id})`);
                
                // التحقق من تهيئة قاعدة البيانات
                if (!this.db) {
                    console.warn('⚠️ قاعدة البيانات غير مهيئة، إعادة التهيئة...');
                    await this.init();
                }
                
                // التحقق من وجود مخزن المنتجات
                if (!this.db.objectStoreNames.contains('products')) {
                    console.warn('⚠️ مخزن المنتجات غير موجود، إعادة إنشاء...');
                    await this.init();
                }
                
                // محاولة إضافة المنتج
                try {
                    const transaction = this.db.transaction(['products'], 'readwrite');
                    const store = transaction.objectStore('products');
                    
                    return new Promise((resolve, reject) => {
                        const req = store.add(product);
                        req.onsuccess = () => {
                            console.log('✅ تم إضافة المنتج بنجاح');
                            resolve(true);
                        };
                        req.onerror = (e) => {
                            console.error('❌ خطأ في إضافة المنتج:', e);
                            reject(e);
                        };
                    });
                } catch (txError) {
                    console.warn('⚠️ خطأ في Transaction، استخدام localStorage:', txError);
                    throw txError;
                }
                
            } catch (error) {
                console.error('❌ خطأ في addProduct:', error);
                // حفظ في localStorage كبديل
                const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser'));
                if (currentUser) {
                    product.userId = currentUser.id;
                    product.userEmail = currentUser.email;
                    product.warehouseId = window.currentWarehouseId || currentUser.warehouseId || currentUser.id;
                    product.createdAt = new Date().toISOString();
                    product.dbVersion = 6;
                }
                const products = JSON.parse(localStorage.getItem('products')) || [];
                products.push(product);
                localStorage.setItem('products', JSON.stringify(products));
                return true;
            }
        }
    };

    AIDatabase.init();
})();
