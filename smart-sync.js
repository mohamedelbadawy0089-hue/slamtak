// =====================================================
// نظام المزامنة الذكية (Smart Sync) - Offline First
// =====================================================

class SmartSync {
    constructor() {
        this.STORAGE_KEY = 'slamtak-pending-products';
        this.SYNC_INTERVAL = 30000; // محاولة المزامنة كل 30 ثانية
        this.init();
    }

    // ✅ تهيئة النظام
    init() {
        console.log('🔄 Smart Sync initialized');
        // بدء المزامنة الدورية
        setInterval(() => this.syncPendingProducts(), this.SYNC_INTERVAL);
        // مزامنة فورية عند استعادة الاتصال
        window.addEventListener('online', () => {
            console.log('🌐 Connection restored - syncing...');
            this.syncPendingProducts();
        });
    }

    // ✅ 1. الحفظ المحلي أولاً (Offline First)
    async saveProductLocally(productData) {
        console.log('💾 Saving product locally...');
        
        // توليد معرف فريد محلي
        const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // إضافة البيانات الوصفية
        const product = {
            ...productData,
            local_id: localId,
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sync_attempts: 0
        };

        // حفظ في localStorage
        const pending = this.getPendingProducts();
        pending.push(product);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(pending));

        console.log('✅ Product saved locally:', localId);
        return product;
    }

    // ✅ 2. المزامنة مع Supabase (Upsert Strategy)
    async syncWithSupabase(product) {
        console.log('☁️ Syncing with Supabase:', product.local_id);
        
        try {
            // جلب بيانات المستخدم
            const userId = localStorage.getItem('slamtak-user-id');
            const warehouseId = localStorage.getItem('slamtak-warehouse-id');
            
            if (!userId || !warehouseId) {
                throw new Error('User or warehouse not found');
            }

            // ✅ استخدام Upsert لمنع التضارب
            const { data, error } = await window.supabaseClient
                .from('products')
                .upsert({
                    local_id: product.local_id,
                    name: product.name,
                    description: product.description,
                    price: product.price,
                    quantity: product.quantity,
                    category: product.category,
                    warehouse_id: warehouseId,
                    user_id: userId,
                    created_at: product.created_at,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'local_id',  // تحديث إذا وجد
                    ignoreDuplicates: false  // تحديث بدلاً من تجاهل
                });

            if (error) {
                throw error;
            }

            console.log('✅ Product synced successfully:', data);
            return { success: true, data };

        } catch (error) {
            console.error('❌ Sync failed:', error);
            return { success: false, error: error.message };
        }
    }

    // ✅ 3. مزامنة جميع المنتجات المعلقة
    async syncPendingProducts() {
        const pending = this.getPendingProducts();
        const pendingProducts = pending.filter(p => p.status === 'pending');
        
        if (pendingProducts.length === 0) {
            return;
        }

        console.log(`🔄 Attempting to sync ${pendingProducts.length} pending products...`);

        let syncedCount = 0;
        let failedCount = 0;

        for (const product of pendingProducts) {
            // زيادة عدد المحاولات
            product.sync_attempts++;

            const result = await this.syncWithSupabase(product);

            if (result.success) {
                // ✅ تحديث الحالة إلى synced
                product.status = 'synced';
                product.synced_at = new Date().toISOString();
                syncedCount++;
                
                // تحديث UI
                this.updateProductUI(product.local_id, 'synced');
            } else {
                failedCount++;
                // إذا فشلت المحاولات كثيراً، نوقف المحاولة مؤقتاً
                if (product.sync_attempts >= 5) {
                    product.status = 'failed';
                }
            }
        }

        // حفظ التحديثات
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(pending));

        console.log(`✅ Synced: ${syncedCount}, Failed: ${failedCount}`);
        
        // إشعار المستخدم
        if (syncedCount > 0) {
            this.showNotification(`تم مزامنة ${syncedCount} منتج بنجاح ✅`);
        }
    }

    // ✅ 4. الحفظ الذكي (الحل الشامل)
    async smartSave(productData) {
        console.log('🚀 Smart Save initiated...');

        // 1. حفظ محلي فوراً
        const product = await this.saveProductLocally(productData);
        
        // تحديث UI (مؤشر الحفظ المحلي)
        this.showSaveStatus(product.local_id, 'pending');

        // 2. محاولة المزامنة إذا كان هناك إنترنت
        if (navigator.onLine) {
            const result = await this.syncWithSupabase(product);
            
            if (result.success) {
                // تحديث الحالة
                product.status = 'synced';
                this.updateLocalProduct(product);
                this.showSaveStatus(product.local_id, 'synced');
                this.showNotification('تم الحفظ ومزامنة المنتج ✅');
                return { success: true, synced: true, product };
            } else {
                // فشل المزامنة - بقي محلياً
                this.showSaveStatus(product.local_id, 'pending');
                this.showNotification('تم الحفظ محلياً - سيتم الرفع عند عودة الإنترنت 📱');
                return { success: true, synced: false, product };
            }
        } else {
            // لا يوجد إنترنت
            this.showSaveStatus(product.local_id, 'pending');
            this.showNotification('تم الحفظ محلياً - سيتم الرفع عند عودة الإنترنت 📱');
            return { success: true, synced: false, product };
        }
    }

    // ✅ دوال مساعدة

    getPendingProducts() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    updateLocalProduct(updatedProduct) {
        const pending = this.getPendingProducts();
        const index = pending.findIndex(p => p.local_id === updatedProduct.local_id);
        if (index !== -1) {
            pending[index] = updatedProduct;
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(pending));
        }
    }

    updateProductUI(localId, status) {
        // البحث عن عنصر المنتج في الصفحة وتحديث حالته
        const productElement = document.querySelector(`[data-local-id="${localId}"]`);
        if (productElement) {
            const statusBadge = productElement.querySelector('.sync-status');
            if (statusBadge) {
                statusBadge.className = `sync-status ${status}`;
                statusBadge.textContent = status === 'synced' ? '✅ متزامن' : '⏳ قيد الانتظار';
            }
        }
    }

    showSaveStatus(localId, status) {
        // إظهار حالة الحفظ في الواجهة
        const statusElement = document.getElementById('save-status');
        if (statusElement) {
            if (status === 'synced') {
                statusElement.innerHTML = '<span class="success">✅ تم الحفظ والمزامنة</span>';
            } else {
                statusElement.innerHTML = '<span class="pending">⏳ تم الحفظ محلياً</span>';
            }
        }
    }

    showNotification(message) {
        // إظهار إشعار للمستخدم
        const notification = document.createElement('div');
        notification.className = 'sync-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #28a745;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // ✅ جلب الإحصائيات
    getSyncStats() {
        const pending = this.getPendingProducts();
        return {
            total: pending.length,
            pending: pending.filter(p => p.status === 'pending').length,
            synced: pending.filter(p => p.status === 'synced').length,
            failed: pending.filter(p => p.status === 'failed').length
        };
    }
}

// ✅ إنشاء نسخة عالمية
window.smartSync = new SmartSync();

// ✅ دالة مساعدة للحفظ السريع
async function smartSaveProduct(productData) {
    return await window.smartSync.smartSave(productData);
}
