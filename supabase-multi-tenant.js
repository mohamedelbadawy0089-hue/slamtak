// ═══════════════════════════════════════════════════════════════
// Supabase Multi-Tenant Connection Module
// نظام الاتصال بـ Supabase - دعم تعدد المخازن
// ═══════════════════════════════════════════════════════════════

const SupabaseConfig = {
    // إعدادات Supabase
    url: 'https://iksjhjxwphmvthryfeae.supabase.co',
    key: 'sb_publishable_0DUy2mtXS6m5S8PwTDAANQ_XWlzbu0G',
    
    // إعدادات التخزين
    storage: {
        sessionKey: 'supabase.auth.token',
        userKey: 'currentUser',
        warehousesKey: 'userWarehouses',
        activeWarehouseKey: 'activeWarehouseId'
    }
};

// إنشاء Supabase Client - باستخدام الـ Singleton فقط
function getSupabaseClient() {
    // ✅ استخدام supabase-singleton.js فقط (منع تكرار الـ Client)
    if (typeof window.SupabaseSingleton !== 'undefined') {
        return window.SupabaseSingleton.getClient();
    }
    
    console.warn('⚠️ SupabaseSingleton غير متوفر، يجب تحميل supabase-singleton.js أولاً');
    return null;
}

// ═══════════════════════════════════════════════════════════════
// دوال فحص الجلسة (Session Management)
// ═══════════════════════════════════════════════════════════════

const SessionManager = {
    // التحقق من وجود جلسة صالحة
    async checkSession() {
        const client = getSupabaseClient();
        if (!client) return null;
        
        try {
            const { data: { session }, error } = await client.auth.getSession();
            
            if (error) {
                console.error('❌ خطأ في جلب الجلسة:', error);
                return null;
            }
            
            if (session && session.user) {
                console.log('✅ جلسة صالحة:', session.user.email);
                return session;
            }
            
            console.log('ℹ️ لا توجد جلسة نشطة');
            return null;
        } catch (error) {
            console.error('❌ خطأ في التحقق من الجلسة:', error);
            return null;
        }
    },
    
    // التحقق من الجلسة وتوجيه إذا لزم الأمر
    async ensureAuthenticated(redirectUrl = 'login.html') {
        const session = await this.checkSession();
        
        if (!session) {
            console.log('🔄 توجيه لصفحة تسجيل الدخول...');
            window.location.href = redirectUrl;
            return false;
        }
        
        return true;
    },
    
    // حفظ بيانات المستخدم في localStorage
    saveUserToStorage(user) {
        if (!user) return;
        
        try {
            const userData = {
                id: user.id,
                email: user.email,
                name: user.user_metadata?.name || user.email,
                phone: user.user_metadata?.phone || '',
                region: user.user_metadata?.region || ''
            };
            
            localStorage.setItem(SupabaseConfig.storage.userKey, JSON.stringify(userData));
            console.log('💾 تم حفظ بيانات المستخدم في localStorage');
        } catch (error) {
            console.error('❌ خطأ في حفظ بيانات المستخدم:', error);
        }
    },
    
    // جلب بيانات المستخدم من localStorage
    getUserFromStorage() {
        try {
            const stored = localStorage.getItem(SupabaseConfig.storage.userKey);
            return stored ? JSON.parse(stored) : null;
        } catch (error) {
            console.error('❌ خطأ في جلب بيانات المستخدم:', error);
            return null;
        }
    },
    
    // مسح بيانات الجلسة
    clearSession() {
        try {
            localStorage.removeItem(SupabaseConfig.storage.sessionKey);
            localStorage.removeItem(SupabaseConfig.storage.userKey);
            localStorage.removeItem(SupabaseConfig.storage.warehousesKey);
            localStorage.removeItem(SupabaseConfig.storage.activeWarehouseKey);
            console.log('🗑️ تم مسح بيانات الجلسة');
        } catch (error) {
            console.error('❌ خطأ في مسح الجلسة:', error);
        }
    }
};

// ═══════════════════════════════════════════════════════════════
// دوال إدارة المخازن (Multi-Warehouse Management)
// ═══════════════════════════════════════════════════════════════

const WarehouseManager = {
    // جلب جميع المخازن للمستخدم
    async getUserWarehouses(userId) {
        const client = getSupabaseClient();
        if (!client) return [];
        
        try {
            const { data, error } = await client
                .from('warehouses')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            
            if (error) {
                console.error('❌ خطأ في جلب المخازن:', error);
                return [];
            }
            
            return data || [];
        } catch (error) {
            console.error('❌ خطأ في getUserWarehouses:', error);
            return [];
        }
    },
    
    // حفظ المخازن في localStorage
    saveWarehousesToLocal(warehouses) {
        localStorage.setItem(SupabaseConfig.storage.warehousesKey, JSON.stringify(warehouses));
    },
    
    // جلب المخازن من localStorage
    getWarehousesFromLocal() {
        const stored = localStorage.getItem(SupabaseConfig.storage.warehousesKey);
        return stored ? JSON.parse(stored) : [];
    },
    
    // تعيين المخزن النشط
    setActiveWarehouse(warehouseId) {
        localStorage.setItem(SupabaseConfig.storage.activeWarehouseKey, warehouseId);
        console.log('🏭 تم تعيين المخزن النشط:', warehouseId);
    },
    
    // جلب المخزن النشط
    getActiveWarehouse() {
        return localStorage.getItem(SupabaseConfig.storage.activeWarehouseKey);
    },
    
    // التحقق من وجود مخزن نشط
    hasActiveWarehouse() {
        return !!this.getActiveWarehouse();
    },
    
    // مسح بيانات المخزن
    clearWarehouseData() {
        localStorage.removeItem(SupabaseConfig.storage.warehousesKey);
        localStorage.removeItem(SupabaseConfig.storage.activeWarehouseKey);
    },
    
    // إنشاء مخزن جديد
    async createWarehouse(warehouseData) {
        const client = getSupabaseClient();
        if (!client) return { success: false, error: 'Supabase غير متوفر' };
        
        try {
            const { data, error } = await client
                .from('warehouses')
                .insert([warehouseData])
                .select()
                .single();
            
            if (error) {
                return { success: false, error: error.message };
            }
            
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    // تحديث بيانات مخزن
    async updateWarehouse(warehouseId, updates) {
        const client = getSupabaseClient();
        if (!client) return { success: false, error: 'Supabase غير متوفر' };
        
        try {
            const { data, error } = await client
                .from('warehouses')
                .update(updates)
                .eq('id', warehouseId)
                .select()
                .single();
            
            if (error) {
                return { success: false, error: error.message };
            }
            
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    // حذف مخزن
    async deleteWarehouse(warehouseId) {
        const client = getSupabaseClient();
        if (!client) return { success: false, error: 'Supabase غير متوفر' };
        
        try {
            const { error } = await client
                .from('warehouses')
                .delete()
                .eq('id', warehouseId);
            
            if (error) {
                return { success: false, error: error.message };
            }
            
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};

// ═══════════════════════════════════════════════════════════════
// دوال المصادقة الموحدة (Unified Auth)
// ═══════════════════════════════════════════════════════════════

const AuthManager = {
    // تسجيل مستخدم جديد
    async signUp(email, password, metadata) {
        const client = getSupabaseClient();
        if (!client) return { success: false, error: 'Supabase غير متوفر' };
        
        try {
            const { data, error } = await client.auth.signUp({
                email,
                password,
                options: {
                    data: metadata
                }
            });
            
            if (error) {
                return { success: false, error: error.message };
            }
            
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    // تسجيل الدخول
    async signIn(email, password) {
        const client = getSupabaseClient();
        if (!client) return { success: false, error: 'Supabase غير متوفر' };
        
        try {
            const { data, error } = await client.auth.signInWithPassword({
                email,
                password
            });
            
            if (error) {
                return { success: false, error: error.message };
            }
            
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    // تسجيل الخروج
    async signOut() {
        const client = getSupabaseClient();
        if (!client) return;
        
        try {
            await client.auth.signOut();
            WarehouseManager.clearWarehouseData();
        } catch (error) {
            console.error('❌ خطأ في تسجيل الخروج:', error);
        }
    },
    
    // جلب الجلسة الحالية
    async getSession() {
        const client = getSupabaseClient();
        if (!client) return null;
        
        try {
            const { data: { session } } = await client.auth.getSession();
            return session;
        } catch (error) {
            return null;
        }
    },
    
    // الاستماع لتغييرات الحالة
    onAuthStateChange(callback) {
        const client = getSupabaseClient();
        if (!client) return;
        
        client.auth.onAuthStateChange((event, session) => {
            callback(event, session);
        });
    },
    
    // حفظ الجلسة في localStorage
    saveSession(session) {
        if (!session) return false;
        
        try {
            const sessionData = {
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                expires_at: session.expires_at,
                user_id: session.user?.id,
                email: session.user?.email,
                timestamp: Date.now()
            };
            
            localStorage.setItem(SupabaseConfig.storage.sessionKey, JSON.stringify(sessionData));
            return true;
        } catch (error) {
            console.error('❌ خطأ في حفظ الجلسة:', error);
            return false;
        }
    },
    
    // تحميل الجلسة من localStorage
    loadSession() {
        try {
            const storedSession = localStorage.getItem(SupabaseConfig.storage.sessionKey);
            const storedUser = localStorage.getItem(SupabaseConfig.storage.userKey);
            
            if (!storedSession || !storedUser) return null;
            
            const sessionData = JSON.parse(storedSession);
            const userData = JSON.parse(storedUser);
            
            if (sessionData.access_token && userData.id) {
                return { session: sessionData, user: userData };
            }
            
            return null;
        } catch (error) {
            return null;
        }
    },
    
    // مسح الجلسة
    clearSession() {
        localStorage.removeItem(SupabaseConfig.storage.sessionKey);
        localStorage.removeItem(SupabaseConfig.storage.userKey);
    }
};

// ═══════════════════════════════════════════════════════════════
// تصدير الدوال للاستخدام العام
// ═══════════════════════════════════════════════════════════════

window.SupabaseConfig = SupabaseConfig;
window.getSupabaseClient = getSupabaseClient;
window.SessionManager = SessionManager;
window.WarehouseManager = WarehouseManager;
window.AuthManager = AuthManager;

console.log('✅ تم تهيئة Supabase Multi-Tenant Module');
