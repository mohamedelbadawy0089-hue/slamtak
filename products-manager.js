// ============================================
// إدارة المنتجات مع Supabase - بدون LocalStorage
// ============================================

class ProductsManager {
    constructor(supabaseClient) {
        this.supabase = supabaseClient;
        this.products = [];
        this.realtimeSubscription = null;
    }

    // ✅ الحصول على المستخدم من Supabase Auth
    async getCurrentUser() {
        const { data: { user } } = await this.supabase.auth.getUser();
        return user;
    }

    // ✅ الحصول على warehouse_id الخاص بالمستخدم من Supabase Auth
    async getWarehouseId() {
        const user = await this.getCurrentUser();
        return user?.id || null;  // ← warehouse_id = auth.uid()
    }

    // ✅ جلب جميع المنتجات (RLS يتكفل بالفلترة)
    async loadProducts() {
        try {
            const { data, error } = await this.supabase
                .from('products')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;

            this.products = data || [];
            console.log('✅ Products loaded:', this.products.length);
            
            return { success: true, data: this.products };

        } catch (error) {
            console.error('Error loading products:', error);
            return { success: false, error: error.message };
        }
    }

    // ✅ البحث في منتجات المخزن (20,000 صنف)
    async searchProducts(searchTerm) {
        try {
            const { data, error } = await this.supabase
                .from('products')
                .select('*')
                .or(`name.ilike.%${searchTerm}%,code.ilike.%${searchTerm}%`)
                .order('name', { ascending: true });

            if (error) throw error;

            console.log('🔍 Search results:', data?.length || 0);
            return { success: true, data: data || [] };

        } catch (error) {
            console.error('Error searching products:', error);
            return { success: false, error: error.message };
        }
    }

    // ✅ إضافة منتج جديد - السيرفر يضع warehouse_id تلقائياً
    async addProduct(productData) {
        try {
            const warehouseId = await this.getWarehouseId();
            if (!warehouseId) {
                throw new Error('يجب تسجيل الدخول أولاً');
            }

            // 🚫 حذف أي warehouse_id قد يكون في البيانات المدخلة
            // السيرفر سيضع warehouse_id تلقائياً عبر DEFAULT auth.uid()
            const { warehouse_id: _, user_id: __, ...cleanData } = productData;

            // ✅ لا نرسل warehouse_id - السيرفر يضعه تلقائياً
            const dataToInsert = {
                ...cleanData,
                created_at: new Date().toISOString()
            };

            const { data, error } = await this.supabase
                .from('products')
                .insert([dataToInsert])
                .select()
                .single();

            if (error) throw error;

            // ✅ تحديث القائمة المحلية
            this.products.push(data);
            
            return { success: true, data };

        } catch (error) {
            console.error('Error adding product:', error);
            return { success: false, error: error.message };
        }
    }

    // ✅ تحديث منتج (فقط للمالك)
    async updateProduct(productId, updates) {
        try {
            const warehouseId = await this.getWarehouseId();
            if (!warehouseId) {
                throw new Error('يجب تسجيل الدخول أولاً');
            }

            const { data, error } = await this.supabase
                .from('products')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', productId)
                .eq('warehouse_id', warehouseId)  // ← فلتر الملكية
                .select()
                .single();

            if (error) throw error;

            // ✅ تحديث في القائمة المحلية
            const index = this.products.findIndex(p => p.id === productId);
            if (index !== -1) {
                this.products[index] = data;
            }

            return { success: true, data };

        } catch (error) {
            console.error('Error updating product:', error);
            return { success: false, error: error.message };
        }
    }

    // ✅ حذف منتج (فقط للمالك)
    async deleteProduct(productId) {
        try {
            const warehouseId = await this.getWarehouseId();
            if (!warehouseId) {
                throw new Error('يجب تسجيل الدخول أولاً');
            }

            const { error } = await this.supabase
                .from('products')
                .delete()
                .eq('id', productId)
                .eq('warehouse_id', warehouseId);  // ← فلتر الملكية

            if (error) throw error;

            // ✅ تحديث UI فوراً
            this.products = this.products.filter(p => p.id !== productId);

            return { success: true };

        } catch (error) {
            console.error('Error deleting product:', error);
            return { success: false, error: error.message };
        }
    }

    // ✅ الاشتراك في التحديثات الفورية
    subscribeToRealtime(onUpdate) {
        try {
            if (this.realtimeSubscription) {
                this.realtimeSubscription.unsubscribe();
            }

            this.realtimeSubscription = this.supabase
                .channel('products_changes')
                .on('postgres_changes', 
                    { event: 'INSERT', schema: 'public', table: 'products' },
                    async (payload) => {
                        console.log('🔄 Real-time INSERT:', payload);
                        await this.handleInsertRealtime(payload, onUpdate);
                    }
                )
                .on('postgres_changes',
                    { event: 'UPDATE', schema: 'public', table: 'products' },
                    async (payload) => {
                        console.log('🔄 Real-time UPDATE:', payload);
                        await this.handleUpdateRealtime(payload, onUpdate);
                    }
                )
                .on('postgres_changes',
                    { event: 'DELETE', schema: 'public', table: 'products' },
                    async (payload) => {
                        console.log('🔄 Real-time DELETE:', payload);
                        await this.handleDeleteRealtime(payload, onUpdate);
                    }
                )
                .subscribe((status) => {
                    console.log('📡 Products realtime status:', status);
                });

            return true;

        } catch (error) {
            console.error('❌ Error subscribing to products realtime:', error);
            return false;
        }
    }

    // ✅ معالجة إضافة جديدة
    async handleInsertRealtime(payload, callback) {
        const { new: newRecord } = payload;
        
        const currentWarehouseId = await this.getWarehouseId();
        if (newRecord.warehouse_id !== currentWarehouseId) {
            console.log('🚫 Ignoring INSERT for different warehouse');
            return;
        }
        
        // ✅ تحديث المصفوفة والـ UI فوراً
        this.products.unshift(newRecord);  // إضافة في البداية
        this.renderProductsList();         // تحديث العرض
        
        if (callback) callback('INSERT', this.products);
        console.log('✅ Product added to UI:', newRecord.name);
    }

    // ✅ عرض قائمة المنتجات في الصفحة
    renderProductsList() {
        const container = document.getElementById('products-list');
        if (!container) return;
        
        container.innerHTML = this.products.map(product => `
            <div class="product-item" data-id="${product.id}">
                <h3>${product.name}</h3>
                <p>Price: ${product.price}</p>
                <p>Quantity: ${product.quantity}</p>
            </div>
        `).join('');
        
        console.log('🔄 UI updated:', this.products.length, 'products');
    }

    // ✅ معالجة تحديث (كمية دواء)
    async handleUpdateRealtime(payload, callback) {
        const { new: newRecord } = payload;
        
        const currentWarehouseId = await this.getWarehouseId();
        if (newRecord.warehouse_id !== currentWarehouseId) {
            console.log('🚫 Ignoring UPDATE for different warehouse');
            return;
        }
        
        const index = this.products.findIndex(p => p.id === newRecord.id);
        if (index !== -1) {
            this.products[index] = newRecord;
            if (callback) callback('UPDATE', this.products, newRecord);
            console.log('✅ Quantity updated in UI:', newRecord.quantity);
        }
    }

    // ✅ معالجة حذف - إزالة فورية من UI
    async handleDeleteRealtime(payload, callback) {
        const { old: oldRecord } = payload;
        
        // ✅ إزالة المنتج من المصفوفة
        this.products = this.products.filter(p => p.id !== oldRecord.id);
        
        // ✅ تحديث الـ UI فوراً
        this.renderProductsList();
        
        if (callback) callback('DELETE', this.products);
        console.log('🗑️ Product removed from UI:', oldRecord.id);
    }

    // إلغاء الاشتراك
    unsubscribe() {
        if (this.realtimeSubscription) {
            this.realtimeSubscription.unsubscribe();
            this.realtimeSubscription = null;
        }
    }
}

// تصدير للاستخدام
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProductsManager;
}
