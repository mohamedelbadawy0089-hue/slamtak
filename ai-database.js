// نظام ربط قاعدة البيانات المحسّن (localStorage Only) - Database & Search (20,000+ Scalable)
// تم تحويله بالكامل من IndexedDB إلى localStorage لتحسين الأداء
(function() {
    'use strict';

    window.AIDatabase = {
        dbName: 'SalamtakDB',
        dbVersion: 6,
        isInitialized: false,

        async init() {
            try {
                console.warn('🚫 تم تعطيل AIDatabase (localStorage Mode) بناءً على طلب المستخدم');
                this.isInitialized = false;
                return false;
            } catch (error) {
                console.error('❌ خطأ في تهيئة AIDatabase:', error);
                return false;
            }
        },

        // هجرة البيانات من LocalStorage القديم إلى الجديد (لمرة واحدة)
        async migrateLocalStorage() {
            try {
                const oldProducts = JSON.parse(localStorage.getItem('products')) || [];
                
                if (oldProducts.length > 0 && !this.getProducts().length) {
                    console.log('📦 Migrating products to new localStorage format...');
                    
                    // إضافة userId للمنتجات القديمة إذا لم يكن موجوداً
                    const userId = localStorage.getItem('currentUser') ? 
                        JSON.parse(localStorage.getItem('currentUser')).id : 'local_user';
                    
                    const migratedProducts = oldProducts.map(product => ({
                        ...product,
                        userId: product.userId || userId,
                        id: product.id || Date.now() + Math.random()
                    }));
                    
                    localStorage.setItem(this.dbName + '_products', JSON.stringify(migratedProducts));
                    localStorage.removeItem('products'); // مسح القديم
                    
                    console.log(`✅ تم هجرة ${migratedProducts.length} منتج`);
                }
            } catch (error) {
                console.error('❌ خطأ في الهجرة:', error);
            }
        },

        // جلب المنتجات من localStorage
        getProducts() {
            try {
                const products = JSON.parse(localStorage.getItem(this.dbName + '_products')) || [];
                return products;
            } catch (error) {
                console.error('❌ خطأ في جلب المنتجات:', error);
                return [];
            }
        },

        // حفظ المنتجات في localStorage
        saveProducts(products) {
            try {
                localStorage.setItem(this.dbName + '_products', JSON.stringify(products));
                return true;
            } catch (error) {
                console.error('❌ خطأ في حفظ المنتجات:', error);
                return false;
            }
        },

        // إضافة منتج جديد
        async addProduct(product) {
            try {
                const products = this.getProducts();
                
                // إضافة بيانات إضافية
                const newProduct = {
                    id: Date.now() + Math.random(),
                    userId: product.userId || this.getCurrentUserId(),
                    timestamp: Date.now(),
                    ...product
                };
                
                products.push(newProduct);
                this.saveProducts(products);
                
                console.log('✅ تم إضافة المنتج:', newProduct.productName);
                return newProduct;
            } catch (error) {
                console.error('❌ خطأ في إضافة المنتج:', error);
                throw error;
            }
        },

        // إضافة أوردر جديد
        async addOrder(order) {
            try {
                const orders = JSON.parse(localStorage.getItem(this.dbName + '_orders')) || [];
                
                // إضافة بيانات إضافية للأوردر
                const newOrder = {
                    id: Date.now() + Math.random(),
                    userId: order.userId || this.getCurrentUserId(),
                    pharmacyId: order.pharmacyId || '', // معرف الصيدلية
                    address: order.address || '',       // عنوان التوصيل
                    province: order.province || '',     // المحافظة
                    timestamp: Date.now(),
                    ...order
                };
                
                orders.push(newOrder);
                localStorage.setItem(this.dbName + '_orders', JSON.stringify(orders));
                
                console.log('✅ تم إضافة الأوردر:', newOrder.orderNumber);
                return newOrder;
            } catch (error) {
                console.error('❌ خطأ في إضافة الأوردر:', error);
                throw error;
            }
        },

        // تحديث منتج
        async updateProduct(productId, updates) {
            try {
                const products = this.getProducts();
                const index = products.findIndex(p => p.id == productId);
                
                if (index !== -1) {
                    products[index] = { ...products[index], ...updates };
                    this.saveProducts(products);
                    console.log('✅ تم تحديث المنتج:', productId);
                    return products[index];
                } else {
                    throw new Error('المنتج غير موجود');
                }
            } catch (error) {
                console.error('❌ خطأ في تحديث المنتج:', error);
                throw error;
            }
        },

        // حذف منتج
        async deleteProduct(productId) {
            try {
                const products = this.getProducts();
                const filteredProducts = products.filter(p => p.id != productId);
                
                if (filteredProducts.length < products.length) {
                    this.saveProducts(filteredProducts);
                    console.log('✅ تم حذف المنتج:', productId);
                    return true;
                } else {
                    throw new Error('المنتج غير موجود');
                }
            } catch (error) {
                console.error('❌ خطأ في حذف المنتج:', error);
                throw error;
            }
        },

        // البحث عن المنتجات
        searchProducts(query, filters = {}) {
            try {
                let products = this.getProducts();
                const userId = filters.userId || this.getCurrentUserId();
                
                // فلترة حسب المستخدم
                if (userId) {
                    products = products.filter(p => p.userId === userId);
                }
                
                // البحث في النص
                if (query) {
                    const searchTerm = query.toLowerCase();
                    products = products.filter(product => 
                        product.productName?.toLowerCase().includes(searchTerm) ||
                        product.barcode?.toLowerCase().includes(searchTerm) ||
                        product.description?.toLowerCase().includes(searchTerm)
                    );
                }
                
                // فلترة إضافية
                if (filters.category) {
                    products = products.filter(p => p.category === filters.category);
                }
                
                if (filters.minPrice) {
                    products = products.filter(p => p.price >= filters.minPrice);
                }
                
                if (filters.maxPrice) {
                    products = products.filter(p => p.price <= filters.maxPrice);
                }
                
                if (filters.expiryDate) {
                    products = products.filter(p => p.expiryDate <= filters.expiryDate);
                }
                
                return products;
            } catch (error) {
                console.error('❌ خطأ في البحث:', error);
                return [];
            }
        },

        // جلب المنتجات حسب المستخدم
        getUserProducts(userId = null) {
            return this.searchProducts(null, { userId });
        },

        // الحصول على معرف المستخدم الحالي
        getCurrentUserId() {
            try {
                const currentUser = localStorage.getItem('currentUser');
                if (currentUser) {
                    return JSON.parse(currentUser).id;
                }
                return 'local_user';
            } catch (error) {
                return 'local_user';
            }
        },

        // الحصول على إحصائيات
        getStats() {
            try {
                const products = this.getProducts();
                const userId = this.getCurrentUserId();
                const userProducts = products.filter(p => p.userId === userId);
                
                return {
                    total: userProducts.length,
                    categories: [...new Set(userProducts.map(p => p.category).filter(Boolean))],
                    expiringSoon: userProducts.filter(p => {
                        if (!p.expiryDate) return false;
                        const expiry = new Date(p.expiryDate);
                        const today = new Date();
                        const daysUntilExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
                        return daysUntilExpiry <= 30 && daysUntilExpiry > 0;
                    }).length,
                    expired: userProducts.filter(p => {
                        if (!p.expiryDate) return false;
                        return new Date(p.expiryDate) < new Date();
                    }).length
                };
            } catch (error) {
                console.error('❌ خطأ في جلب الإحصائيات:', error);
                return { total: 0, categories: [], expiringSoon: 0, expired: 0 };
            }
        },

        // تصدير البيانات
        exportData() {
            try {
                const products = this.getUserProducts();
                const dataStr = JSON.stringify(products, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(dataBlob);
                
                const link = document.createElement('a');
                link.href = url;
                link.download = `products_export_${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                
                console.log('✅ تم تصدير البيانات');
            } catch (error) {
                console.error('❌ خطأ في التصدير:', error);
            }
        },

        // استيراد البيانات
        importData(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const importedProducts = JSON.parse(e.target.result);
                        const userId = this.getCurrentUserId();
                        
                        // إضافة معرف المستخدم للمنتجات المستوردة
                        const productsWithUserId = importedProducts.map(product => ({
                            ...product,
                            userId: product.userId || userId,
                            id: product.id || Date.now() + Math.random()
                        }));
                        
                        // دمج مع المنتجات الحالية
                        const currentProducts = this.getProducts();
                        const mergedProducts = [...currentProducts, ...productsWithUserId];
                        
                        // إزالة التكرار بناءً على الاسم والباركود
                        const uniqueProducts = mergedProducts.filter((product, index, self) => 
                            index === self.findIndex(p => 
                                p.productName === product.productName && 
                                p.barcode === product.barcode
                            )
                        );
                        
                        this.saveProducts(uniqueProducts);
                        console.log(`✅ تم استيراد ${productsWithUserId.length} منتج`);
                        resolve(productsWithUserId.length);
                    } catch (error) {
                        console.error('❌ خطأ في الاستيراد:', error);
                        reject(error);
                    }
                };
                reader.readAsText(file);
            });
        },

        // مسح جميع البيانات
        clearAllData() {
            try {
                localStorage.removeItem(this.dbName + '_products');
                localStorage.removeItem(this.dbName + '_initialized');
                console.log('🗑️ تم مسح جميع البيانات');
                return true;
            } catch (error) {
                console.error('❌ خطأ في مسح البيانات:', error);
                return false;
            }
        }
    };

    // تهيئة تلقائية
    document.addEventListener('DOMContentLoaded', async () => {
        await window.AIDatabase.init();
    });

})();
