/**
 * نظام الفحص الهجين والجلسة المستمرة (Hybrid Check & Persistent Session)
 * 
 * المبادئ:
 * 1. Local First: الأولوية للبيانات المحلية
 * 2. No Forced Redirects: لا توجيه إجباري للدخول
 * 3. Background Sync: تحديث في الخلفية
 * 4. Token Lifecycle: استخدام Refresh Token لفترة طويلة
 * 5. SignOut Only: التسجيل فقط عند الضغط يدوياً
 */

window.HybridAuth = {
    // ===== تكوين النظام =====
    config: {
        // مفاتيح التخزين
        STORAGE_KEY: 'hybrid-auth-session',
        USER_KEY: 'hybrid-auth-user',
        WAREHOUSE_KEY: 'hybrid-auth-warehouse',
        ROLE_KEY: 'hybrid-auth-role',
        
        // إعدادات الجلسة
        SESSION_DURATION: 365 * 24 * 60 * 60 * 1000, // سنة كاملة
        REFRESH_INTERVAL: 5 * 60 * 1000, // تحديث كل 5 دقائق
        
        // أعلام الحالة
        isRefreshing: false,
        lastRefreshAttempt: null
    },

    // ===== الحالة الحالية =====
    state: {
        session: null,
        user: null,
        warehouseId: null,
        role: null,
        isAuthenticated: false,
        lastError: null,
        networkStatus: 'online'
    },

    // ===== التهيئة =====
    init() {
        console.log('🔐 Hybrid Auth System Initialized');
        this.loadLocalSession();
        this.setupNetworkListeners();
        this.startBackgroundSync();
        return this;
    },

    // ===== استراتيجية Local First =====
    loadLocalSession() {
        try {
            // محاولة استرجاع الجلسة من localStorage
            const sessionData = localStorage.getItem(this.config.STORAGE_KEY);
            const userData = localStorage.getItem(this.config.USER_KEY);
            const warehouseData = localStorage.getItem(this.config.WAREHOUSE_KEY);

            if (sessionData && userData) {
                this.state.session = JSON.parse(sessionData);
                this.state.user = JSON.parse(userData);
                this.state.warehouseId = warehouseData;
                this.state.role = localStorage.getItem(this.config.ROLE_KEY);
                this.state.isAuthenticated = true;
                
                console.log('✅ Local session loaded:', {
                    user: this.state.user?.email,
                    warehouse: this.state.warehouseId,
                    expires: new Date(this.state.session?.expires_at).toLocaleString()
                });
                
                return true;
            }
            
            console.log('ℹ️ No local session found');
            return false;
        } catch (e) {
            console.error('❌ Error loading local session:', e);
            return false;
        }
    },

    // ===== حفظ الجلسة محلياً =====
    saveLocalSession(session, user, warehouseId) {
        try {
            if (session) {
                localStorage.setItem(this.config.STORAGE_KEY, JSON.stringify(session));
            }
            if (user) {
                localStorage.setItem(this.config.USER_KEY, JSON.stringify(user));
            }
            if (warehouseId) {
                localStorage.setItem(this.config.WAREHOUSE_KEY, warehouseId);
            }
            if (localStorage.getItem('slamtak-user-role')) {
                const role = localStorage.getItem('slamtak-user-role');
                localStorage.setItem(this.config.ROLE_KEY, role);
                this.state.role = role;
            }
            
            this.state.session = session;
            this.state.user = user;
            this.state.warehouseId = warehouseId;
            this.state.isAuthenticated = true;
            
            console.log('💾 Session saved locally');
            return true;
        } catch (e) {
            console.error('❌ Error saving session:', e);
            return false;
        }
    },

    // ===== التحقق الهجين (الأهم) =====
    async checkAuth(options = {}) {
        const { allowLocal = true, silent = true, background = false } = options;
        
        // المرحلة 1: التحقق المحلي (Local First)
        if (allowLocal && this.state.isAuthenticated && this.state.session) {
            console.log('✅ Using local session (Local First)');
            
            // إذا كان الطلب في الخلفية، نعود فوراً
            if (background) {
                this.syncWithSupabaseSilent();
                return { 
                    authenticated: true, 
                    user: this.state.user, 
                    source: 'local',
                    warehouseId: this.state.warehouseId 
                };
            }
            
            // تحديث في الخلفية (غير متزامن)
            this.syncWithSupabaseSilent();
            
            return { 
                authenticated: true, 
                user: this.state.user, 
                source: 'local',
                warehouseId: this.state.warehouseId 
            };
        }
        
        // المرحلة 2: التحقق من Supabase
        try {
            const result = await this.checkSupabaseSession();
            
            if (result.authenticated) {
                // حفظ الجلسة الجديدة محلياً
                this.saveLocalSession(result.session, result.user, result.warehouseId);
                return { 
                    authenticated: true, 
                    user: result.user, 
                    source: 'supabase',
                    warehouseId: result.warehouseId 
                };
            }
            
            // لا يوجد جلسة صالحة
            if (!silent) {
                return { 
                    authenticated: false, 
                    user: null, 
                    source: 'none',
                    error: 'No valid session'
                };
            }
            
            // في الوضع الصامت: نعود بيانات محلية قديمة إن وجدت
            if (this.state.user) {
                console.log('⚠️ Using stale local data (Silent Mode)');
                return { 
                    authenticated: true, 
                    user: this.state.user, 
                    source: 'local-stale',
                    warehouseId: this.state.warehouseId,
                    warning: 'Using cached data'
                };
            }
            
            return { 
                authenticated: false, 
                user: null, 
                source: 'none' 
            };
            
        } catch (e) {
            console.error('❌ Auth check error:', e);
            this.state.lastError = e;
            
            // في حالة الخطأ: استخدم البيانات المحلية إن وجدت
            if (this.state.user) {
                console.log('⚠️ Network/Error - Using local fallback');
                return { 
                    authenticated: true, 
                    user: this.state.user, 
                    source: 'local-fallback',
                    warehouseId: this.state.warehouseId,
                    error: e.message 
                };
            }
            
            return { 
                authenticated: false, 
                user: null, 
                source: 'error',
                error: e.message 
            };
        }
    },

    // ===== التحقق من Supabase =====
    async checkSupabaseSession() {
        const supabase = window.SupabaseSingleton?.getClient();
        if (!supabase) {
            throw new Error('Supabase client not available');
        }
        
        try {
            // استخدام getSession (لا ترفع خطأ إذا لم تكن هناك جلسة)
            const { data: { session }, error } = await supabase.auth.getSession();
            
            if (error) {
                console.error('❌ Supabase session error:', error);
                return { authenticated: false, error: error.message };
            }
            
            if (!session) {
                return { authenticated: false };
            }
            
            // جلب بيانات المستخدم
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            
            if (userError) {
                console.error('❌ User fetch error:', userError);
                return { authenticated: false, error: userError.message };
            }
            
            const warehouseId = user?.user_metadata?.warehouse_id || 
                               localStorage.getItem('current_warehouse_id');
            
            console.log('✅ Supabase session valid:', {
                user: user?.email,
                expires: new Date(session.expires_at).toLocaleString()
            });
            
            return { 
                authenticated: true, 
                session, 
                user,
                warehouseId 
            };
            
        } catch (e) {
            console.error('❌ Supabase check error:', e);
            throw e;
        }
    },

    // ===== تحديث صامت في الخلفية =====
    async syncWithSupabaseSilent() {
        if (this.config.isRefreshing) {
            console.log('⏳ Already refreshing, skipping...');
            return;
        }
        
        this.config.isRefreshing = true;
        this.config.lastRefreshAttempt = Date.now();
        
        try {
            console.log('🔄 Background sync started...');
            
            const result = await this.checkSupabaseSession();
            
            if (result.authenticated) {
                // تحديث البيانات المحلية
                this.saveLocalSession(result.session, result.user, result.warehouseId);
                console.log('✅ Background sync completed');
            } else {
                console.log('⚠️ Background sync: No valid session on server');
            }
            
        } catch (e) {
            console.log('⚠️ Background sync failed (network?):', e.message);
            // لا نفعل شيئاً - نحتفظ بالبيانات المحلية
        } finally {
            this.config.isRefreshing = false;
        }
    },

    // ===== بدء التزامن الدوري =====
    startBackgroundSync() {
        // تحديث كل 5 دقائق
        setInterval(() => {
            this.syncWithSupabaseSilent();
        }, this.config.REFRESH_INTERVAL);
        
        // تحديث عند استعادة الاتصال
        window.addEventListener('online', () => {
            console.log('🌐 Connection restored, syncing...');
            this.state.networkStatus = 'online';
            this.syncWithSupabaseSilent();
        });
        
        console.log('🔄 Background sync started (every 5 minutes)');
    },

    // ===== مراقبة حالة الشبكة =====
    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.state.networkStatus = 'online';
            console.log('🌐 Online');
        });
        
        window.addEventListener('offline', () => {
            this.state.networkStatus = 'offline';
            console.log('📴 Offline - Using local mode');
        });
    },

    // ===== تجديد التوكن يدوياً (اختياري) =====
    async refreshToken() {
        const supabase = window.SupabaseSingleton?.getClient();
        if (!supabase) return { success: false, error: 'No client' };
        
        try {
            const { data: { session }, error } = await supabase.auth.refreshSession();
            
            if (error) {
                console.error('❌ Token refresh failed:', error);
                return { success: false, error: error.message };
            }
            
            if (session) {
                this.saveLocalSession(session, this.state.user, this.state.warehouseId);
                console.log('✅ Token refreshed successfully');
                return { success: true, session };
            }
            
            return { success: false, error: 'No session returned' };
            
        } catch (e) {
            console.error('❌ Refresh error:', e);
            return { success: false, error: e.message };
        }
    },

    // ===== تسجيل الخروج (الحالة الوحيدة للتوجيه) =====
    async signOut(redirectTo = '/login.html') {
        const supabase = window.SupabaseSingleton?.getClient();
        
        try {
            if (supabase) {
                await supabase.auth.signOut();
            }
        } catch (e) {
            console.error('❌ SignOut error:', e);
        } finally {
            // مسح جميع البيانات المحلية
            this.clearAllData();
            
            // الآن فقط: التوجيه لصفحة الدخول
            console.log('👋 User signed out, redirecting to login...');
            window.location.replace(redirectTo);
        }
    },

    // ===== مسح البيانات =====
    clearAllData() {
        localStorage.removeItem(this.config.STORAGE_KEY);
        localStorage.removeItem(this.config.USER_KEY);
        localStorage.removeItem(this.config.WAREHOUSE_KEY);
        
        this.state = {
            session: null,
            user: null,
            warehouseId: null,
            isAuthenticated: false,
            lastError: null,
            networkStatus: this.state.networkStatus
        };
        
        console.log('🧹 All auth data cleared');
    },

    // ===== الحصول على UUID المخزن =====
    getWarehouseId() {
        // الأولوية: البيانات في الذاكرة
        if (this.state.warehouseId) {
            return this.state.warehouseId;
        }
        
        // الثانية: localStorage العام
        return localStorage.getItem('current_warehouse_id') || 
               localStorage.getItem('warehouse_id') || 
               this.state.user?.user_metadata?.warehouse_id ||
               null;
    },

    getUserId() {
        return this.state.user?.id || null;
    },

    // ===== التحقق السريع (للاستخدام في كل صفحة) =====
    isLoggedIn() {
        return this.state.isAuthenticated || this.loadLocalSession();
    }
};

// ===== مُساعد الـ API مع Try-Catch =====
window.HybridAPI = {
    async call(apiFunction, fallbackData = null) {
        try {
            // التحقق من الجلسة أولاً
            const auth = await window.HybridAuth.checkAuth({ silent: true });
            
            if (!auth.authenticated) {
                console.warn('⚠️ Not authenticated, returning fallback');
                return { data: fallbackData, error: null, fromFallback: true };
            }
            
            // تنفيذ الاستعلام
            const result = await apiFunction();
            
            return { data: result.data, error: result.error, fromFallback: false };
            
        } catch (e) {
            console.error('❌ API call failed:', e);
            
            // في حالة خطأ 401/403: نحاول تجديد الجلسة
            if (e.message?.includes('401') || e.message?.includes('403') || 
                e.message?.includes('JWT') || e.message?.includes('token')) {
                
                console.log('🔄 Token error detected, attempting refresh...');
                const refresh = await window.HybridAuth.refreshToken();
                
                if (refresh.success) {
                    // إعادة المحاولة
                    try {
                        const result = await apiFunction();
                        return { data: result.data, error: result.error, refreshed: true };
                    } catch (e2) {
                        console.error('❌ Retry failed:', e2);
                    }
                }
            }
            
            // إرجاع البيانات الاحتياطية
            return { data: fallbackData, error: e, fromFallback: true };
        }
    }
};

// ===== التهيئة التلقائية =====
document.addEventListener('DOMContentLoaded', () => {
    window.HybridAuth.init();
});

console.log('🚀 Hybrid Auth System loaded - Ready for persistent sessions!');
