// =====================================================
// نظام المزامنة الهجين (Hybrid Sync) - Offline First + Smart Upload
// =====================================================

class HybridSync {
    constructor() {
        this.STORAGE_KEY = 'slamtak-products';
        this.SYNC_KEY = 'slamtak-sync-queue';
        this.SYNC_INTERVAL = 30000; // 30 ثانية
        this.init();
    }

    // ✅ التهيئة والمزامنة الدورية
    init() {
        console.log('🔄 Hybrid Sync initialized');
        
        // مزامنة دورية
        setInterval(() => this.processSyncQueue(), this.SYNC_INTERVAL);
        
        // مزامنة فورية عند استعادة الاتصال
        window.addEventListener('online', async () => {
            console.log('🌐 Connection restored - starting sync...');
            await this.processSyncQueue();
        });
        
        // بدء المزامنة عند تحميل الصفحة
        if (navigator.onLine) {
            this.processSyncQueue();
        }
    }

    // ✅ 1. الحفظ المحلي الفوري مع local_id فريد
    async saveLocal(productData) {
        console.log('💾 Saving to localStorage...');
        
        // توليد local_id فريد (هجين من التوقيت + عشوائي)
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 11);
        const localId = `local_${timestamp}_${random}`;
        
        const product = {
            ...productData,
            local_id: localId,
            status: 'pending',        // pending | synced | failed
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sync_attempts: 0
        };

        // حفظ في localStorage
        const products = this.getLocalProducts();
        products.push(product);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(products));
        
        // إضافة لقائمة المزامنة
        this.addToSyncQueue(localId);
        
        console.log('✅ Saved locally:', localId);
        return product;
    }

    // ✅ 2. رفع البيانات باستخدام Upsert (مع التحقق من الجلسة)
    async uploadToSupabase(product) {
        console.log('☁️ Uploading to Supabase:', product.local_id);
        
        try {
            // 🔐 التحقق من الجلسة أولاً
            const { data: { session }, error: sessionError } = await window.supabaseClient.auth.getSession();
            
            if (sessionError || !session) {
                console.warn('⚠️ No active session, skipping upload');
                return { success: false, error: 'No session', retryable: true };
            }
            
            console.log('🔐 Active session found:', session.user.id);
            
            // جلب warehouse_id
            const warehouseId = localStorage.getItem('slamtak-warehouse-id');
            if (!warehouseId) {
                return { success: false, error: 'No warehouse', retryable: false };
            }
            
            // ✅ استخدام Upsert لمنع التكرار
            // ملاحظة: لا نرسل user_id لأن الـ Trigger يضيفه تلقائياً
            const { data, error } = await window.supabaseClient
                .from('products')
                .upsert({
                    local_id: product.local_id,        // ← مفتاح منع التكرار
                    name: product.name,
                    description: product.description || '',
                    price: product.price,
                    quantity: product.quantity,
                    category: product.category,
                    warehouse_id: warehouseId,
                    // user_id: لا ترسل! السيرفر يضيفه via Trigger
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'local_id',             // ← منع التضارب
                    ignoreDuplicates: false             // ← تحديث لو موجود
                })
                .select();
            
            if (error) {
                // التحقق إذا كان الخطأ متعلق بالـ RLS
                if (error.message && error.message.includes('row-level security')) {
                    console.error('🚫 RLS Policy violation:', error);
                    return { success: false, error: 'Access denied', retryable: false };
                }
                throw error;
            }
            
            console.log('✅ Uploaded successfully:', data);
            return { success: true, data };
            
        } catch (error) {
            console.error('❌ Upload failed:', error);
            return { success: false, error: error.message, retryable: true };
        }
    }

    // ✅ 3. معالجة قائمة المزامنة
    async processSyncQueue() {
        if (!navigator.onLine) {
            console.log('📴 Offline - skipping sync');
            return;
        }
        
        const queue = this.getSyncQueue();
        const pending = queue.filter(id => {
            const product = this.getProductByLocalId(id);
            return product && product.status === 'pending';
        });
        
        if (pending.length === 0) {
            return;
        }
        
        console.log(`🔄 Processing ${pending.length} pending items...`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const localId of pending) {
            const product = this.getProductByLocalId(localId);
            if (!product) continue;
            
            // زيادة عدد المحاولات
            product.sync_attempts++;
            
            const result = await this.uploadToSupabase(product);
            
            if (result.success) {
                // ✅ تحديث الحالة إلى synced
                product.status = 'synced';
                product.synced_at = new Date().toISOString();
                this.updateLocalProduct(product);
                this.removeFromSyncQueue(localId);
                successCount++;
                
                // إشعار UI
                this.showNotification('✅ تمت مزامنة منتج');
            } else {
                // فشل - تحديث الحالة
                if (product.sync_attempts >= 5) {
                    product.status = 'failed';
                    this.updateLocalProduct(product);
                    this.removeFromSyncQueue(localId);
                }
                failCount++;
            }
        }
        
        console.log(`📊 Sync complete: ${successCount} success, ${failCount} failed`);
    }

    // ✅ 4. الحفظ الذكي الشامل
    async smartSave(productData) {
        console.log('🚀 Smart Save started...');
        
        const statusEl = document.getElementById('sync-status');
        
        // 1. حفظ محلي فوراً
        const product = await this.saveLocal(productData);
        
        // 2. تحديث UI
        if (statusEl) {
            statusEl.innerHTML = '<span class="pending">⏳ تم الحفظ محلياً</span>';
        }
        
        // 3. محاولة المزامنة إذا كان متصلاً
        if (navigator.onLine) {
            const result = await this.uploadToSupabase(product);
            
            if (result.success) {
                product.status = 'synced';
                product.synced_at = new Date().toISOString();
                this.updateLocalProduct(product);
                this.removeFromSyncQueue(product.local_id);
                
                if (statusEl) {
                    statusEl.innerHTML = '<span class="synced">✅ تمت المزامنة</span>';
                }
                
                return { success: true, synced: true, product };
            } else {
                // سيتم المحاولة لاحقاً تلقائياً
                if (statusEl) {
                    statusEl.innerHTML = '<span class="pending">⏳ تم الحفظ - سيتم الرفع تلقائياً</span>';
                }
                return { success: true, synced: false, product };
            }
        } else {
            // غير متصل - سيرتفع تلقائياً عند العودة
            if (statusEl) {
                statusEl.innerHTML = '<span class="pending">📴 غير متصل - سيتم الرفع لاحقاً</span>';
            }
            return { success: true, synced: false, product };
        }
    }

    // ✅ دوال مساعدة
    
    getLocalProducts() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }
    
    getProductByLocalId(localId) {
        const products = this.getLocalProducts();
        return products.find(p => p.local_id === localId);
    }
    
    updateLocalProduct(updatedProduct) {
        const products = this.getLocalProducts();
        const index = products.findIndex(p => p.local_id === updatedProduct.local_id);
        if (index !== -1) {
            products[index] = updatedProduct;
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(products));
        }
    }
    
    getSyncQueue() {
        const stored = localStorage.getItem(this.SYNC_KEY);
        return stored ? JSON.parse(stored) : [];
    }
    
    addToSyncQueue(localId) {
        const queue = this.getSyncQueue();
        if (!queue.includes(localId)) {
            queue.push(localId);
            localStorage.setItem(this.SYNC_KEY, JSON.stringify(queue));
        }
    }
    
    removeFromSyncQueue(localId) {
        const queue = this.getSyncQueue();
        const filtered = queue.filter(id => id !== localId);
        localStorage.setItem(this.SYNC_KEY, JSON.stringify(filtered));
    }
    
    showNotification(message) {
        const notif = document.createElement('div');
        notif.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #28a745;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        notif.textContent = message;
        document.body.appendChild(notif);
        
        setTimeout(() => notif.remove(), 3000);
    }
    
    getStats() {
        const products = this.getLocalProducts();
        return {
            total: products.length,
            pending: products.filter(p => p.status === 'pending').length,
            synced: products.filter(p => p.status === 'synced').length,
            failed: products.filter(p => p.status === 'failed').length
        };
    }
}

// ✅ إنشاء نسخة عالمية
window.hybridSync = new HybridSync();

// ✅ دالة سهلة للاستخدام
async function saveProduct(productData) {
    return await window.hybridSync.smartSave(productData);
}
