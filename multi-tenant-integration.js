// ============================================
// Multi-Tenant SaaS Integration for Slamtak
// كل مخزن يرى بياناته فقط - عزل كامل بين المستخدمين
// ============================================

(function() {
    'use strict';

    // ============================================
    // 1. الحصول على معرف المستخدم الحالي
    // ============================================
    function getCurrentUserId() {
        // محاولة جلب من عدة مصادر
        return localStorage.getItem('slamtak-user-id') || 
               localStorage.getItem('current_warehouse_id') ||
               localStorage.getItem('slamtak-warehouse-id') ||
               null;
    }

    function getCurrentWarehouseId() {
        return localStorage.getItem('current_warehouse_id') || 
               localStorage.getItem('slamtak-warehouse-id') ||
               getCurrentUserId();
    }

    // ============================================
    // 2. تعديل Supabase Client ليدعم Multi-tenant
    // ============================================
    function patchSupabaseForMultiTenant(supabaseClient) {
        if (!supabaseClient || supabaseClient._isPatchedForMultiTenant) {
            return supabaseClient;
        }

        // حفظ الدالة الأصلية
        const originalFrom = supabaseClient.from.bind(supabaseClient);

        // تعديل دالة from لإضافة الفلاتر تلقائياً
        supabaseClient.from = function(tableName) {
            const query = originalFrom(tableName);
            const userId = getCurrentUserId();

            // إضافة فلتر user_id تلقائياً للجداول الحساسة
            const tenantTables = [
                'warehouses', 'products', 'orders', 'pharmacies',
                'delivery_personnel', 'categories', 'suppliers',
                'sales', 'settings', 'order_status_history',
                'delivery_tracking', 'analytics'
            ];

            if (tenantTables.includes(tableName) && userId) {
                // تخزين الفلتر الأصلي
                const originalEq = query.eq.bind(query);
                
                // تعديل دالة eq
                query.eq = function(column, value) {
                    const result = originalEq(column, value);
                    // إعادة ربط eq للنتائج
                    return patchQueryForTenant(result, tableName, userId);
                };

                // إضافة فلتر user_id كأول عملية
                return patchQueryForTenant(originalEq('user_id', userId), tableName, userId);
            }

            return query;
        };

        // تعديل دالة insert لإضافة user_id تلقائياً
        const originalInsert = supabaseClient.from.bind(supabaseClient);
        
        supabaseClient._originalFrom = originalFrom;
        supabaseClient._isPatchedForMultiTenant = true;

        console.log('✅ Supabase Client patched for Multi-Tenant');
        return supabaseClient;
    }

    // تعديل الـ Query Builder
    function patchQueryForTenant(query, tableName, userId) {
        if (!query || query._isPatchedForTenant) return query;

        // حفظ insert الأصلي
        const originalInsert = query.insert.bind(query);
        const originalUpdate = query.update ? query.update.bind(query) : null;

        // تعديل insert لإضافة user_id تلقائياً
        query.insert = function(data, options = {}) {
            const userId = getCurrentUserId();
            
            if (Array.isArray(data)) {
                // إذا كان مصفوفة
                data = data.map(item => ({
                    ...item,
                    user_id: item.user_id || userId,
                    warehouse_id: item.warehouse_id || getCurrentWarehouseId()
                }));
            } else {
                // إذا كان object واحد
                data = {
                    ...data,
                    user_id: data.user_id || userId,
                    warehouse_id: data.warehouse_id || getCurrentWarehouseId()
                };
            }

            console.log(`📝 Inserting into ${tableName} with user_id:`, userId);
            return originalInsert(data, options);
        };

        // تعديل update لإضافة فلتر user_id
        if (originalUpdate) {
            query.update = function(updates, options = {}) {
                const userId = getCurrentUserId();
                
                // إضافة warehouse_id إذا لم يكن موجوداً
                if (!updates.warehouse_id) {
                    updates.warehouse_id = getCurrentWarehouseId();
                }

                console.log(`📝 Updating ${tableName} for user_id:`, userId);
                return originalUpdate(updates, options);
            };
        }

        query._isPatchedForTenant = true;
        return query;
    }

    // ============================================
    // 3. كلاس MultiTenantManager
    // ============================================
    class MultiTenantManager {
        constructor(supabaseClient) {
            this.supabase = patchSupabaseForMultiTenant(supabaseClient);
            this.userId = getCurrentUserId();
            this.warehouseId = getCurrentWarehouseId();
            this.subscriptions = {};
        }

        // ========== CRUD مع عزل تلقائي ==========

        // إضافة سجل (مع user_id و warehouse_id تلقائي)
        async insert(tableName, data) {
            try {
                const dataWithTenant = {
                    ...data,
                    user_id: this.userId,
                    warehouse_id: data.warehouse_id || this.warehouseId
                };

                const { data: result, error } = await this.supabase
                    .from(tableName)
                    .insert([dataWithTenant])
                    .select()
                    .single();

                if (error) throw error;
                
                console.log(`✅ Inserted into ${tableName}:`, result.id);
                return { success: true, data: result };

            } catch (error) {
                console.error(`❌ Error inserting into ${tableName}:`, error);
                return { success: false, error: error.message };
            }
        }

        // جلب البيانات (مع فلتر user_id تلقائي)
        async select(tableName, options = {}) {
            try {
                let query = this.supabase
                    .from(tableName)
                    .select(options.columns || '*');

                // فلتر user_id إجباري (إلا إذا طُلب عكس ذلك)
                if (!options.skipTenantFilter && this.userId) {
                    query = query.eq('user_id', this.userId);
                }

                // فلتر warehouse_id إضافي
                if (options.filterByWarehouse && this.warehouseId) {
                    query = query.eq('warehouse_id', this.warehouseId);
                }

                // فلاتر مخصصة
                if (options.filters) {
                    options.filters.forEach(filter => {
                        query = query.eq(filter.column, filter.value);
                    });
                }

                // LIKE search
                if (options.search) {
                    query = query.or(options.search);
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

        // تحديث سجل (مع فلتر user_id)
        async update(tableName, id, updates) {
            try {
                let query = this.supabase
                    .from(tableName)
                    .update({
                        ...updates,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', id);

                // فلتر user_id للأمان
                if (this.userId) {
                    query = query.eq('user_id', this.userId);
                }

                const { data, error } = await query.select().single();

                if (error) throw error;

                console.log(`✅ Updated ${tableName}:`, id);
                return { success: true, data };

            } catch (error) {
                console.error(`❌ Error updating ${tableName}:`, error);
                return { success: false, error: error.message };
            }
        }

        // حذف سجل (مع فلتر user_id)
        async delete(tableName, id) {
            try {
                let query = this.supabase
                    .from(tableName)
                    .delete()
                    .eq('id', id);

                // فلتر user_id للأمان
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

        // ========== Real-time مع عزل ==========

        subscribeToTable(tableName, callback, options = {}) {
            try {
                // إلغاء الاشتراك السابق
                if (this.subscriptions[tableName]) {
                    this.subscriptions[tableName].unsubscribe();
                }

                let filter = '';
                
                // بناء الفلتر مع user_id
                if (this.userId && !options.skipTenantFilter) {
                    filter = `user_id=eq.${this.userId}`;
                }

                if (options.additionalFilters) {
                    filter += filter ? `,${options.additionalFilters}` : options.additionalFilters;
                }

                this.subscriptions[tableName] = this.supabase
                    .channel(`${tableName}_tenant_changes`)
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

                console.log(`✅ Subscribed to ${tableName} (tenant isolated)`);
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

        refreshUserId() {
            this.userId = getCurrentUserId();
            this.warehouseId = getCurrentWarehouseId();
            console.log('🔄 Refreshed tenant IDs:', this.userId);
        }

        getTenantInfo() {
            return {
                userId: this.userId,
                warehouseId: this.warehouseId,
                isAuthenticated: !!this.userId
            };
        }
    }

    // ============================================
    // 4. دوال مساعدة عالمية
    // ============================================

    // تعديل أي supabase client موجود
    window.patchSupabaseForMultiTenant = patchSupabaseForMultiTenant;

    // إنشاء مدير متعدد المستأجرين
    window.createMultiTenantManager = function(supabaseClient) {
        return new MultiTenantManager(supabaseClient);
    };

    // تصدير MultiTenantManager
    window.MultiTenantManager = MultiTenantManager;

    // دوال الحصول على المعرفات
    window.getCurrentUserId = getCurrentUserId;
    window.getCurrentWarehouseId = getCurrentWarehouseId;

    console.log('✅ Multi-Tenant Integration loaded successfully');

})();
