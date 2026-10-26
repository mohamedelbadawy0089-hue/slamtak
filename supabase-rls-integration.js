// ============================================
// تكامل RLS مع Supabase - جميع الجداول
// ============================================

class SupabaseRLSManager {
    constructor(supabaseClient) {
        this.supabase = supabaseClient;
        this.userId = localStorage.getItem('slamtak-user-id');
        this.warehouseId = localStorage.getItem('current_warehouse_id') || this.userId;
        
        // Real-time subscriptions
        this.subscriptions = {};
    }

    // ========== Generic CRUD with user_id ==========

    // إضافة سجل مع user_id تلقائياً
    async insert(tableName, data) {
        try {
            const dataWithUser = {
                ...data,
                user_id: this.userId,  // ← ربط تلقائي بـ ID الحساب
                warehouse_id: data.warehouse_id || this.warehouseId
            };

            const { data: result, error } = await this.supabase
                .from(tableName)
                .insert([dataWithUser])
                .select()
                .single();

            if (error) throw error;
            
            console.log(`✅ Inserted into ${tableName}:`, result);
            return { success: true, data: result };

        } catch (error) {
            console.error(`❌ Error inserting into ${tableName}:`, error);
            return { success: false, error: error.message };
        }
    }

    // جلب البيانات (فقط للمستخدم الحالي)
    async select(tableName, options = {}) {
        try {
            let query = this.supabase
                .from(tableName)
                .select(options.columns || '*');

            // تصفية حسب user_id (للأمان - RLS)
            if (this.userId && !options.skipUserFilter) {
                query = query.eq('user_id', this.userId);
            }

            // تصفية حسب warehouse_id إذا مطلوب
            if (options.warehouseId) {
                query = query.eq('warehouse_id', options.warehouseId);
            }

            // فلاتر إضافية
            if (options.filters) {
                options.filters.forEach(filter => {
                    query = query.eq(filter.column, filter.value);
                });
            }

            // الترتيب
            if (options.orderBy) {
                query = query.order(options.orderBy, { 
                    ascending: options.ascending !== false 
                });
            }

            // التصفية
            if (options.limit) {
                query = query.limit(options.limit);
            }

            const { data, error } = await query;

            if (error) throw error;

            return { success: true, data: data || [] };

        } catch (error) {
            console.error(`❌ Error selecting from ${tableName}:`, error);
            return { success: false, error: error.message, data: [] };
        }
    }

    // تحديث سجل (فقط للمستخدم الحالي)
    async update(tableName, id, updates) {
        try {
            let query = this.supabase
                .from(tableName)
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);

            // التأكد من أن السجل للمستخدم الحالي
            if (this.userId) {
                query = query.eq('user_id', this.userId);
            }

            const { data, error } = await query.select().single();

            if (error) throw error;

            console.log(`✅ Updated ${tableName}:`, data);
            return { success: true, data };

        } catch (error) {
            console.error(`❌ Error updating ${tableName}:`, error);
            return { success: false, error: error.message };
        }
    }

    // حذف سجل (فقط للمستخدم الحالي)
    async delete(tableName, id) {
        try {
            let query = this.supabase
                .from(tableName)
                .delete()
                .eq('id', id);

            // التأكد من أن السجل للمستخدم الحالي
            if (this.userId) {
                query = query.eq('user_id', this.userId);
            }

            const { error } = await query;

            if (error) throw error;

            console.log(`✅ Deleted from ${tableName}:`, id);
            return { success: true };

        } catch (error) {
            console.error(`❌ Error deleting from ${tableName}:`, error);
            return { success: false, error: error.message };
        }
    }

    // ========== Table-Specific Methods ==========

    // المنتجات
    async addProduct(productData) {
        return this.insert('products', productData);
    }

    async getProducts(options = {}) {
        return this.select('products', { ...options, orderBy: 'name' });
    }

    async updateProduct(id, updates) {
        return this.update('products', id, updates);
    }

    async deleteProduct(id) {
        return this.delete('products', id);
    }

    // الطلبات
    async addOrder(orderData) {
        return this.insert('orders', orderData);
    }

    async getOrders(options = {}) {
        return this.select('orders', { ...options, orderBy: 'created_at', ascending: false });
    }

    async updateOrder(id, updates) {
        return this.update('orders', id, updates);
    }

    async deleteOrder(id) {
        return this.delete('orders', id);
    }

    // الصيدليات
    async addPharmacy(pharmacyData) {
        return this.insert('pharmacies', pharmacyData);
    }

    async getPharmacies(options = {}) {
        return this.select('pharmacies', { ...options, orderBy: 'name' });
    }

    async updatePharmacy(id, updates) {
        return this.update('pharmacies', id, updates);
    }

    async deletePharmacy(id) {
        return this.delete('pharmacies', id);
    }

    // المخازن
    async addWarehouse(warehouseData) {
        const dataWithOwner = {
            ...warehouseData,
            owner_id: this.userId  // خاصة للمخازن
        };
        return this.insert('warehouses', dataWithOwner);
    }

    async getWarehouses(options = {}) {
        try {
            let query = this.supabase
                .from('warehouses')
                .select(options.columns || '*');

            // للمخازن، نتحقق من user_id أو owner_id
            if (this.userId && !options.skipUserFilter) {
                query = query.or(`user_id.eq.${this.userId},owner_id.eq.${this.userId}`);
            }

            const { data, error } = await query;

            if (error) throw error;
            return { success: true, data: data || [] };

        } catch (error) {
            console.error('❌ Error fetching warehouses:', error);
            return { success: false, error: error.message, data: [] };
        }
    }

    // المندوبين
    async addDeliveryPerson(personData) {
        return this.insert('delivery_personnel', personData);
    }

    async getDeliveryPersonnel(options = {}) {
        return this.select('delivery_personnel', options);
    }

    // المبيعات
    async addSale(saleData) {
        return this.insert('sales', saleData);
    }

    async getSales(options = {}) {
        return this.select('sales', { ...options, orderBy: 'created_at', ascending: false });
    }

    // التصنيفات
    async addCategory(categoryData) {
        return this.insert('categories', categoryData);
    }

    async getCategories(options = {}) {
        return this.select('categories', { ...options, orderBy: 'name' });
    }

    // الموردين
    async addSupplier(supplierData) {
        return this.insert('suppliers', supplierData);
    }

    async getSuppliers(options = {}) {
        return this.select('suppliers', { ...options, orderBy: 'name' });
    }

    // الإعدادات
    async addSetting(settingData) {
        return this.insert('settings', settingData);
    }

    async getSettings(options = {}) {
        return this.select('settings', options);
    }

    // ========== Real-time Subscriptions ==========

    subscribeToTable(tableName, callback, filters = {}) {
        try {
            // إلغاء الاشتراك السابق إذا وجد
            if (this.subscriptions[tableName]) {
                this.subscriptions[tableName].unsubscribe();
            }

            let filter = '';
            
            // بناء الفلتر
            if (this.userId) {
                filter = `user_id=eq.${this.userId}`;
            }
            
            if (filters.warehouseId) {
                filter += filter ? `,warehouse_id=eq.${filters.warehouseId}` : `warehouse_id=eq.${filters.warehouseId}`;
            }

            this.subscriptions[tableName] = this.supabase
                .channel(`${tableName}_changes`)
                .on('postgres_changes', 
                    { 
                        event: '*', 
                        schema: 'public', 
                        table: tableName,
                        filter: filter || undefined
                    },
                    (payload) => {
                        console.log(`Real-time ${tableName} update:`, payload);
                        
                        // التحقق من أن التحديث للمستخدم الحالي
                        if (this.userId && payload.new && payload.new.user_id !== this.userId) {
                            console.log(`Ignoring ${tableName} update for different user`);
                            return;
                        }
                        
                        callback(payload);
                    }
                )
                .subscribe();

            console.log(`✅ Subscribed to ${tableName} changes`);
            return true;

        } catch (error) {
            console.error(`❌ Error subscribing to ${tableName}:`, error);
            return false;
        }
    }

    unsubscribeFromTable(tableName) {
        if (this.subscriptions[tableName]) {
            this.subscriptions[tableName].unsubscribe();
            delete this.subscriptions[tableName];
            console.log(`❌ Unsubscribed from ${tableName}`);
        }
    }

    unsubscribeAll() {
        Object.keys(this.subscriptions).forEach(tableName => {
            this.unsubscribeFromTable(tableName);
        });
    }

    // ========== Helper Methods ==========

    setUserId(userId) {
        this.userId = userId;
        localStorage.setItem('slamtak-user-id', userId);
    }

    setWarehouseId(warehouseId) {
        this.warehouseId = warehouseId;
        localStorage.setItem('current_warehouse_id', warehouseId);
    }

    getCurrentUser() {
        return {
            userId: this.userId,
            warehouseId: this.warehouseId
        };
    }
}

// ============================================
// مثال الاستخدام
// ============================================

/*
// 1. إنشاء المدير
const rlsManager = new SupabaseRLSManager(supabaseClient);

// 2. إضافة منتج (user_id يُضاف تلقائياً)
await rlsManager.addProduct({
    name: 'منتج تجريبي',
    price: 100,
    quantity: 50
});

// 3. جلب المنتجات (فقط للمستخدم الحالي)
const products = await rlsManager.getProducts();

// 4. Real-time - الاشتراك في التحديثات
rlsManager.subscribeToTable('products', (payload) => {
    console.log('Product updated:', payload);
    // تحديث الواجهة هنا
});

// 5. إلغاء الاشتراك
rlsManager.unsubscribeFromTable('products');
*/

// تصدير للاستخدام
window.SupabaseRLSManager = SupabaseRLSManager;
