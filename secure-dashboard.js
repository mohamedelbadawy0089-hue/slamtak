// ============================================
// Secure Dashboard - لوحة تحكم آمنة مع Route Guard
// ============================================

class SecureDashboard {
    constructor() {
        this.supabase = null;
        this.currentUserId = null;
        this.routeGuard = null;
    }

    // ✅ تهيئة الصفحة الآمنة
    async initialize() {
        try {
            // 1. ✅ تشغيل Route Guard
            const initResult = await RouteGuard.init();
            if (!initResult) {
                console.error('🚫 Dashboard initialization failed: Access denied');
                return false;
            }

            this.routeGuard = initResult.guard;
            this.currentUserId = initResult.userId;
            this.supabase = window.SupabaseSingleton?.getClient?.() || window.supabase;

            console.log('✅ Secure Dashboard initialized for user:', this.currentUserId);

            // 2. ✅ تحميل البيانات بشكل آمن (RLS)
            await this.loadSecureData();

            // 3. ✅ إعداد Realtime
            this.setupSecureRealtime();

            return true;

        } catch (error) {
            console.error('❌ Dashboard error:', error.message);
            this.routeGuard?.redirectToLogin('initialization_error');
            return false;
        }
    }

    // ✅ تحميل البيانات بشكل آمن - لا نمرر أي ID
    async loadSecureData() {
        try {
            // ✅ RLS يتولى الفلترة تلقائياً - لا نمرر user_id
            const { data: products, error: productsError } = await this.routeGuard.fetchWithRLS('products');
            if (productsError) throw productsError;

            const { data: pharmacies, error: pharmaciesError } = await this.routeGuard.fetchWithRLS('pharmacies');
            if (pharmaciesError) throw pharmaciesError;

            // عرض البيانات
            this.renderProducts(products?.data || []);
            this.renderPharmacies(pharmacies?.data || []);

            console.log('✅ Secure data loaded:', {
                products: products?.data?.length || 0,
                pharmacies: pharmacies?.data?.length || 0
            });

        } catch (error) {
            console.error('❌ Failed to load secure data:', error.message);
            this.showError('فشل تحميل البيانات: ' + error.message);
        }
    }

    // ✅ إعداد Realtime آمن
    setupSecureRealtime() {
        // الاستماع للتغييرات فقط على بيانات المستخدم الحالي (RLS يفلتر)
        this.supabase
            .channel('secure_changes')
            .on('postgres_changes', 
                { event: '*', schema: 'public', table: 'products' },
                (payload) => this.handleRealtimeChange(payload)
            )
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'pharmacies' },
                (payload) => this.handleRealtimeChange(payload)
            )
            .subscribe();

        console.log('✅ Secure Realtime setup complete');
    }

    // ✅ معالجة التغييرات في الوقت الفعلي
    handleRealtimeChange(payload) {
        const { eventType, new: newRecord, old: oldRecord } = payload;

        // ✅ التحقق من الملكية (فلتر إضافي)
        if (newRecord && newRecord.user_id !== this.currentUserId) {
            console.log('🚫 Ignoring change for different user');
            return;
        }

        console.log(`🔄 Realtime ${eventType}:`, payload);
        
        // تحديث UI
        switch (eventType) {
            case 'INSERT':
                this.addRecordToUI(newRecord);
                break;
            case 'UPDATE':
                this.updateRecordInUI(newRecord);
                break;
            case 'DELETE':
                this.removeRecordFromUI(oldRecord.id);
                break;
        }
    }

    // ✅ إضافة منتج جديد (بدون تمرير user_id)
    async addProductSecure(productData) {
        try {
            // ✅ لا نمرر أي user_id أو warehouse_id
            const { user_id, warehouse_id, ...cleanData } = productData;

            const { data, error } = await this.supabase
                .from('products')
                .insert([{
                    ...cleanData,
                    created_at: new Date().toISOString()
                    // RLS و DEFAULT سيتوليان user_id
                }])
                .select()
                .single();

            if (error) throw error;

            console.log('✅ Product added securely:', data);
            return { success: true, data };

        } catch (error) {
            console.error('❌ Add product failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    // ✅ حذف منتج (RLS يتأكد من الملكية)
    async deleteProductSecure(productId) {
        try {
            const { data, error } = await this.supabase
                .from('products')
                .delete()
                .eq('id', productId)
                .select();

            if (error) throw error;

            // ✅ التحقق من أن الحذف تم (RLS منع إذا لم يكن المالك)
            if (!data || data.length === 0) {
                console.warn('⚠️ Delete prevented by RLS or product not found');
                return { success: false, error: 'Unauthorized or not found' };
            }

            console.log('✅ Product deleted securely');
            return { success: true };

        } catch (error) {
            console.error('❌ Delete failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    // ✅ مساعدات UI
    renderProducts(products) {
        const container = document.getElementById('products-list');
        if (!container) return;
        
        container.innerHTML = products.map(p => `
            <div class="product-card" data-id="${p.id}">
                <h3>${p.name}</h3>
                <p>السعر: ${p.price} جنيه</p>
                <p>الكمية: ${p.quantity}</p>
                <button onclick="dashboard.deleteProductSecure('${p.id}')">حذف</button>
            </div>
        `).join('');
    }

    renderPharmacies(pharmacies) {
        const container = document.getElementById('pharmacies-list');
        if (!container) return;
        
        container.innerHTML = pharmacies.map(p => `
            <div class="pharmacy-card" data-id="${p.id}">
                <h3>${p.name}</h3>
                <p>التليفون: ${p.phone}</p>
            </div>
        `).join('');
    }

    addRecordToUI(record) {
        // إضافة فورية للقائمة
        console.log('➕ Record added:', record);
    }

    updateRecordInUI(record) {
        // تحديث فوري
        console.log('✏️ Record updated:', record);
    }

    removeRecordFromUI(id) {
        // إزالة فورية
        console.log('🗑️ Record removed:', id);
    }

    showError(message) {
        console.error('❌ Error:', message);
        // عرض رسالة للمستخدم
    }
}

// تصدير للاستخدام
window.SecureDashboard = SecureDashboard;

// تشغيل تلقائي
const dashboard = new SecureDashboard();
dashboard.initialize();
