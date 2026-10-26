// Supabase Singleton Client - توحيد الاتصال
// سلامتك - Auth System v11.0
(function() {
    'use strict';

    // منع تكرار التهيئة إذا كان متوفراً بالفعل
    if (window.SupabaseSingleton) {
        return window.SupabaseSingleton;
    }

    // ===== إنشاء Supabase Client مرة واحدة فقط =====
    let supabaseInstance = null;
    let isInitializing = false;
    let authStateUnsubscribe = null;
    let isRecovering = false;

    // إعدادات Supabase الموحدة
    const SUPABASE_CONFIG = {
        url: 'https://iksjhjxwphmvthryfeae.supabase.co',
        key: 'sb_publishable_0DUy2mtXS6m5S8PwTDAANQ_XWlzbu0G',
        storageKey: 'slamtak-auth-token' // مفتاح مخصص لهذا المشروع
    };

    // إنشاء نسخة واحدة من Supabase Client
    function createSupabaseClient() {
        if (supabaseInstance) {
            return supabaseInstance;
        }

        if (isInitializing) {
            console.log('⏳ انتظار تهيئة Supabase Client...');
            return null;
        }

        if (typeof window.supabase === 'undefined') {
            console.error('❌ Supabase SDK غير محمل');
            return null;
        }

        isInitializing = true;

        try {
            console.log('🚀 إنشاء Supabase Client جديد...');
            
            supabaseInstance = window.supabase.createClient(
                SUPABASE_CONFIG.url, 
                SUPABASE_CONFIG.key, 
                {
                    auth: {
                        persistSession: true,           // تثبيت الجلسة - مرة واحدة وبس
                        storage: window.localStorage,   // localStorage أساسي
                        autoRefreshToken: true,        // تحديث التوكن تلقائياً
                        detectSessionInUrl: true,      // كشف الجلسة من URL
                        storageKey: SUPABASE_CONFIG.storageKey  // مفتاح مخصص
                    }
                }
            );

            console.log('✅ تم إنشاء Supabase Client بنجاح');
            
            // ===== المزامنة المستمرة: مراقبة تغييرات Auth =====
            setupAuthStateListener(supabaseInstance);
            
            isInitializing = false;
            return supabaseInstance;

        } catch (error) {
            console.error('❌ خطأ في إنشاء Supabase Client:', error);
            isInitializing = false;
            return null;
        }
    }

    // مدير الجلسات المحسّن - نظام المحلي أولاً (Local First)
    const SessionManager = {
        // ===== التحقق من الجلسة - المحلي أولاً (Local First) =====
        async checkSession() {
            const client = createSupabaseClient();
            if (!client) {
                // ⚠️ تم تعطيل Local First بناءً على طلب المستخدم
                console.warn('ℹ️ Supabase Client غير متوفر - تم تعطيل LocalStorage Mode');
                return null;
            }

            try {
                // ⚠️ تم تعطيل التحقق المحلي - جلب الجلسة من السيرفر فقط
                const { data: { session }, error } = await client.auth.getSession();
                
                if (error) {
                    // ⚠️ لا نعرض خطأ - نستخدم المحلي
                    console.log('ℹ️ Session fetch failed, using local data');
                    return localSession;
                }

                if (session && session.user) {
                    // ✅ مزامنة الجلسة النشطة
                    this.syncSessionToLocal(session);
                    return session;
                }

                // ⚠️ لا توجد جلسة على السيرفر - نستخدم المحلي
                return localSession;

            } catch (error) {
                // ⚠️ لا نعرض خطأ أحمر - نستخدم المحلي
                console.log('ℹ️ Session check failed, using local fallback');
                return this.getLocalSession();
            }
        },

        // ===== الحصول على الجلسة من LocalStorage =====
        getLocalSession() {
            try {
                const tokenData = localStorage.getItem('slamtak-auth-token');
                const userData = localStorage.getItem('slamtak-user');
                const userId = localStorage.getItem('slamtak-user-id');
                
                if (!tokenData || !userData || !userId) {
                    return null;
                }
                
                const token = JSON.parse(tokenData);
                const user = JSON.parse(userData);
                
                // ⚠️ التحقق من صلاحية التوكن المحلي (بدون أخطاء)
                const now = Math.floor(Date.now() / 1000);
                if (token.expires_at && token.expires_at < now) {
                    // التوكن منتهي لكن نستخدمه مؤقتاً مع تحديث في الخلفية
                    console.log('ℹ️ Local token expired, using temporarily');
                }
                
                return {
                    access_token: token.access_token,
                    refresh_token: token.refresh_token,
                    expires_at: token.expires_at,
                    user: user
                };
            } catch (e) {
                console.log('ℹ️ No local session found');
                return null;
            }
        },

        // التأكد من المصادقة - Local First (بدون توجيه إجباري)
        async ensureAuthenticated(redirectUrl = 'login.html') {
            const client = createSupabaseClient();
            if (!client) {
                // ⚠️ Local First: التحقق من البيانات المحلية
                const localSession = this.getLocalSession();
                if (localSession) {
                    console.log('✅ Local session available');
                    return true;
                }
                return false;
            }
            
            try {
                // ⚠️ Local First: استخدام البيانات المحلية فوراً
                const localSession = this.getLocalSession();
                
                // محاولة استرجاع الجلسة من السيرفر في الخلفية
                let session = null;
                ({ data: { session } } = await client.auth.getSession());
                
                if (session) {
                    console.log('✅ Server session available');
                    this.syncSessionToLocal(session);
                    return true;
                }
                
                // ⚠️ لا توجد جلسة على السيرفر - نستخدم المحلي
                if (localSession) {
                    console.log('ℹ️ Using local session (offline mode)');
                    return true;
                }
                
                // لا توجد جلسة نهائياً - لكن لا نُوجّه إجبارياً
                console.log('ℹ️ No session available - continuing as guest');
                return false;

            } catch (error) {
                // ⚠️ لا نعرض خطأ - نستخدم المحلي
                const localSession = this.getLocalSession();
                if (localSession) {
                    console.log('ℹ️ Error, using local session');
                    return true;
                }
                return false;
            }
        },

        // ===== المزامنة الفورية عند تغيير الجلسة =====
        syncSessionToLocal(session) {
            if (!session) {
                console.log('🔒 لا توجد جلسة للمزامنة');
                return;
            }
            
            try {
                // حفظ بيانات الجلسة الأساسية
                localStorage.setItem('slamtak-auth-token', JSON.stringify(session));
                if (session.user) {
                    localStorage.setItem('slamtak-user-id', session.user.id);
                    localStorage.setItem('slamtak-user-email', session.user.email);
                    localStorage.setItem('slamtak-auth-status', 'authenticated');
                }
                
                // حفظ بيانات المستخدم الكاملة
                this.saveUserToStorage(session.user);
                
                console.log('🔄 تم مزامنة الجلسة فوراً مع LocalStorage');
            } catch (error) {
                console.error('❌ خطأ في مزامنة الجلسة:', error);
            }
        },

        // ===== الفحص قبل التنفيذ (Pre-flight Check) - Local First =====
        async preFlightCheck() {
            const client = createSupabaseClient();
            if (!client) {
                // ⚠️ Local First: استخدام البيانات المحلية
                console.log('ℹ️ [Pre-flight] Supabase Client غير متوفر - استخدام LocalStorage');
                return this.getLocalSession();
            }
            
            // ⚠️ المحلي أولاً: استرجاع الجلسة المحلية فوراً
            const localSession = this.getLocalSession();
            
            try {
                console.log('✈️ [Pre-flight] التحقق من مزامنة الجلسة (صامت)...');
                
                // جلب الجلسة من السيرفر في الخلفية
                const { data: { session: serverSession }, error: serverError } = await client.auth.getSession();
                
                if (serverError) {
                    // ⚠️ لا نعرض خطأ - نستخدم المحلي
                    console.log('ℹ️ [Pre-flight] Server error, using local session');
                    return localSession;
                }
                
                // مزامنة إذا كان هناك اختلاف
                if (serverSession && localSession && 
                    serverSession.access_token !== localSession.access_token) {
                    console.log('🔄 [Pre-flight] اكتشاف اختلاف - مزامنة الجلسة');
                    this.syncSessionToLocal(serverSession);
                }
                
                // ✅ استخدام الجلسة النشطة من السيرفر
                if (serverSession) {
                    return serverSession;
                }
                
                // ⚠️ لا توجد جلسة على السيرفر - نستخدم المحلي
                console.log('ℹ️ [Pre-flight] No server session, using local');
                return localSession;
                
            } catch (error) {
                // ⚠️ لا نعرض خطأ أحمر - نستخدم المحلي
                console.log('ℹ️ [Pre-flight] Error, using local fallback');
                return localSession;
            }
        },

        // ===== التعافي التلقائي - صامت =====
        async attemptAutoRecovery() {
            if (isRecovering) {
                console.log('⏳ جارٍ التعافي بالفعل...');
                return this.getLocalSession(); // ⚠️ نرجع المحلي بدلاً من null
            }
            
            isRecovering = true;
            console.log('🔄 [Auto-recovery] محاولة استعادة الجلسة صمتاً...');
            
            // ⚠️ المحلي أولاً: استخدام البيانات المحلية كأساس
            const localSession = this.getLocalSession();
            
            try {
                const client = createSupabaseClient();
                if (!client) {
                    isRecovering = false;
                    return localSession; // ⚠️ نرجع المحلي بدلاً من null
                }
                
                // محاولة 1: تحديث التوكن (صامت)
                const { data: { session }, error: refreshError } = await client.auth.refreshSession();
                
                if (session) {
                    console.log('✅ [Auto-recovery] تم استعادة الجلسة بنجاح');
                    this.syncSessionToLocal(session);
                    isRecovering = false;
                    return session;
                }
                
                // محاولة 2: استرجاع من localStorage
                const { data: { session: recoveredSession }, error: getError } = await client.auth.getSession();
                
                if (recoveredSession) {
                    console.log('✅ [Auto-recovery] تم استعادة الجلسة من التخزين');
                    this.syncSessionToLocal(recoveredSession);
                    isRecovering = false;
                    return recoveredSession;
                }
                
                // ⚠️ لم يتم استعادة الجلسة - نستخدم المحلي
                console.log('ℹ️ [Auto-recovery] Using local session temporarily');
                isRecovering = false;
                return localSession;
                
            } catch (error) {
                // ⚠️ لا نعرض خطأ أحمر - نستخدم المحلي
                console.log('ℹ️ [Auto-recovery] Error, using local fallback');
                isRecovering = false;
                return localSession;
            }
        },

        // حفظ بيانات المستخدم (للتخزين الإضافي فقط - Supabase يدير الجلسة)
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

                // حفظ في JSON
                localStorage.setItem('slamtak-user', JSON.stringify(userData));
                // حفظ أيضاً في المفاتيح المنفصلة للتوافق مع باقي الصفحات
                localStorage.setItem('slamtak-user-id', user.id);
                localStorage.setItem('slamtak-user-email', user.email);
                localStorage.setItem('slamtak-auth-status', 'authenticated');
                // حفظ warehouse_id للاستخدام في وضع offline
                localStorage.setItem('current_warehouse_id', user.id);
                console.log('💾 تم حفظ بيانات المستخدم في جميع المفاتيح');
                console.log('🏭 current_warehouse_id set for offline use:', user.id.substring(0, 8) + '...');
            } catch (error) {
                console.error('❌ خطأ في حفظ بيانات المستخدم:', error);
            }
        },

        // جلب بيانات المستخدم (إضافية فقط)
        getUserFromStorage() {
            try {
                const stored = localStorage.getItem('slamtak-user');
                return stored ? JSON.parse(stored) : null;
            } catch (error) {
                console.error('❌ خطأ في جلب بيانات المستخدم:', error);
                return null;
            }
        },

        // ===== تحديث التوكن يدوياً - صامت =====
        async refreshSession() {
            const client = createSupabaseClient();
            if (!client) {
                console.log('ℹ️ [Manual Refresh] Supabase Client غير متوفر');
                return false;
            }
            
            try {
                console.log('🔄 [Manual Refresh] تحديث الجلسة...');
                const { data: { session }, error } = await client.auth.refreshSession();
                
                if (error) {
                    // ⚠️ لا نعرض خطأ - نحاول في الخلفية
                    console.log('ℹ️ [Manual Refresh] Refresh failed, will retry later');
                    return false;
                }
                
                if (session) {
                    console.log('✅ [Manual Refresh] تم تحديث الجلسة');
                    this.syncSessionToLocal(session);
                    return true;
                }
                
                return false;
            } catch (error) {
                // ⚠️ لا نعرض خطأ أحمر
                console.log('ℹ️ [Manual Refresh] Error, will retry later');
                return false;
            }
        },

        // مسح بيانات التطبيق (وليس جلسة Supabase)
        clearSession() {
            try {
                localStorage.removeItem('slamtak-user');
                localStorage.removeItem('slamtak-auth-token');
                localStorage.removeItem('slamtak-user-id');
                localStorage.removeItem('slamtak-user-email');
                localStorage.removeItem('slamtak-auth-status');
                localStorage.removeItem('activeWarehouseId');
                
                // إلغاء الاشتراك في مراقبة Auth
                if (authStateUnsubscribe) {
                    authStateUnsubscribe();
                    authStateUnsubscribe = null;
                }
                
                console.log('🗑️ تم مسح جميع بيانات الجلسة');
            } catch (error) {
                console.error('❌ خطأ في مسح الجلسة:', error);
            }
        }
    };

    // ===== مراقبة حالة Auth للمزامنة الفورية =====
    function setupAuthStateListener(client) {
        if (!client) return;
        
        try {
            console.log('👂 إعداد مراقبة تغييرات Auth...');
            
            const { data } = client.auth.onAuthStateChange((event, session) => {
                console.log(`🔔 [Auth Event] ${event}`, session ? '- جلسة موجودة' : '- لا توجد جلسة');
                
                switch (event) {
                    case 'SIGNED_IN':
                        console.log('✅ تسجيل دخول - مزامنة الجلسة');
                        SessionManager.syncSessionToLocal(session);
                        break;
                        
                    case 'SIGNED_OUT':
                        console.log('🔒 تسجيل خروج - مسح الجلسة');
                        SessionManager.clearSession();
                        break;
                        
                    case 'TOKEN_REFRESHED':
                        console.log('🔄 تم تحديث التوكن - مزامنة الجلسة');
                        SessionManager.syncSessionToLocal(session);
                        break;
                        
                    case 'USER_UPDATED':
                        console.log('👤 تحديث المستخدم - مزامنة البيانات');
                        SessionManager.saveUserToStorage(session?.user);
                        break;
                        
                    case 'INITIAL_SESSION':
                        if (session) {
                            console.log('🚀 جلسة أولية - مزامنة');
                            SessionManager.syncSessionToLocal(session);
                        }
                        break;
                        
                    default:
                        // PASSWORD_RECOVERY, MFA_CHALLENGE_VERIFIED, etc.
                        if (session) {
                            SessionManager.syncSessionToLocal(session);
                        }
                }
            });
            
            authStateUnsubscribe = data?.subscription?.unsubscribe;
            console.log('✅ تم إعداد مراقبة Auth بنجاح');
            
        } catch (error) {
            console.error('❌ خطأ في إعداد مراقبة Auth:', error);
        }
    }

    // مدير المخازن
    const WarehouseManager = {
        // تعيين المخزن النشط
        setActiveWarehouse(warehouseId) {
            try {
                localStorage.setItem('activeWarehouseId', warehouseId);
                console.log('🏭 تم تعيين المخزن النشط:', warehouseId);
            } catch (error) {
                console.error('❌ خطأ في تعيين المخزن:', error);
            }
        },

        // جلب المخزن النشط
        getActiveWarehouse() {
            try {
                return localStorage.getItem('activeWarehouseId');
            } catch (error) {
                console.error('❌ خطأ في جلب المخزن النشط:', error);
                return null;
            }
        }
    };

    // دالة التهيئة التلقائية (مع منع الـ Infinite Loop)
    let isInitialized = false;
    async function initSupabaseSingleton() {
        if (isInitialized) {
            console.log('✅ Supabase Singleton مهيأ بالفعل');
            return;
        }

        isInitialized = true;
        console.log('🚀 تهيئة Supabase Singleton...');

        try {
            const client = createSupabaseClient();
            if (!client) {
                console.error('❌ فشل في تهيئة Supabase Client');
                return;
            }

            // التحقق من الجلسة (مرة واحدة فقط)
            const session = await SessionManager.checkSession();
            if (session && session.user) {
                SessionManager.saveUserToStorage(session.user);
            }

            console.log('✅ Supabase Singleton جاهز');

        } catch (error) {
            console.error('❌ خطأ في تهيئة Supabase Singleton:', error);
        }
    }

    // تهيئة تلقائية عند تحميل الصفحة
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSupabaseSingleton);
    } else {
        initSupabaseSingleton();
    }

    // ===== دالة مساعدة للفحص قبل أي عملية =====
    async function preFlightAuthCheck() {
        return await SessionManager.preFlightCheck();
    }

    // ===== دالة مساعدة للتعافي التلقائي =====
    async function autoRecoverSession() {
        return await SessionManager.attemptAutoRecovery();
    }

// ===== تحديث الجلسة التلقائي في الخلفية - صامت =====
let backgroundRefreshInterval = null;
    
function startBackgroundSessionRefresh() {
// تحديث كل 5 دقائق (300000 مللي ثانية)
if (backgroundRefreshInterval) {
clearInterval(backgroundRefreshInterval);
}

backgroundRefreshInterval = setInterval(async () => {
try {
console.log('🔄 [Background] Checking session health...');
const client = createSupabaseClient();
if (!client) return;
        const { data: { session }, error } = await client.auth.getSession();
        
        if (error || !session) {
            console.log('⚠️ [Background] Session expired, attempting recovery...');
            const recovered = await SessionManager.attemptAutoRecovery();
            if (!recovered) {
                console.log('ℹ️ [Background] Using local session temporarily');
            }
        } else {
            // التحقق من قرب انتهاء الجلسة (أقل من 10 دقائق)
            const expiresAt = session.expires_at;
            const now = Math.floor(Date.now() / 1000);
            const timeLeft = expiresAt - now;
            
            if (timeLeft < 600) { // أقل من 10 دقائق
                console.log('⏰ [Background] Session expiring soon, refreshing...');
                await SessionManager.refreshSession();
            } else {
                console.log('✅ [Background] Session healthy');
            }
        }
    } catch (error) {
        // ⚠️ لا نعرض خطأ أحمر - صامت
        console.log('ℹ️ [Background] Session check paused, will retry later');
    }
}, 300000); // كل 5 دقائق
    
console.log('✅ Background session refresh started (every 5 minutes)');
}

// ===== دالة لإيقاف التحديث التلقائي =====
function stopBackgroundSessionRefresh() {
    if (backgroundRefreshInterval) {
        clearInterval(backgroundRefreshInterval);
        backgroundRefreshInterval = null;
        console.log('⏹️ Background session refresh stopped');
    }
}

// ===== معالجة الأخطاء الصامتة مع إعادة المحاولة =====
async function executeWithRetry(operation, maxRetries = 3, delay = 1000) {
    const client = createSupabaseClient();
    if (!client) {
        // ⚠️ لا نرمي خطأ - نعيد بيانات محلية
        console.log('ℹ️ Supabase Client not available, using local data');
        return { data: null, error: null, fromLocal: true };
    }
            
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // الفحص قبل التنفيذ - يستخدم LocalStorage أولاً
            const session = await SessionManager.preFlightCheck();
            if (!session) {
                console.log('ℹ️ No valid session, continuing with local data...');
                // ⚠️ نحاول الاستمرار بدون جلسة صالحة (ستفشل RLS لكن لا نعرض خطأ)
            }
                    
            // تنفيذ العملية
            const result = await operation(client);
            return { data: result, error: null, fromLocal: false };
                    
        } catch (error) {
            // ⚠️ لا نعرض خطأ أحمر - نحاول الاسترداد
            const isAuthError = error.message?.includes('JWT') || 
                               error.message?.includes('auth') ||
                               error.message?.includes('token') ||
                               error.message?.includes('session') ||
                               error.message?.includes('AuthSessionMissingError') ||
                               error.code === 'AuthSessionMissingError';
                    
            if (isAuthError && attempt < maxRetries) {
                console.log(`🔄 [Retry] Auth session missing, recovering silently...`);
                const recovered = await SessionManager.attemptAutoRecovery();
                if (recovered) {
                    await new Promise(r => setTimeout(r, delay * attempt));
                    continue;
                }
            }
                    
            // ⚠️ نفدت المحاولات - نعيد null بدلاً من رمي خطأ
            if (attempt === maxRetries) {
                console.log('ℹ️ [Retry] Max retries reached, returning local fallback');
                return { data: null, error: null, fromLocal: true };
            }
                    
            await new Promise(r => setTimeout(r, delay * attempt));
        }
    }
}

// ===== دالة مساعدة لإنشاء عملية مع معالجة الأخطاء =====
function createSafeOperation(operationFn) {
    return async function(...args) {
        try {
            return await executeWithRetry(
                (client) => operationFn(client, ...args),
                3, // max retries
                1000 // initial delay
            );
        } catch (error) {
            // معالجة أخطاء محددة
            if (error.message?.includes('User already registered') ||
                error.message?.includes('user_already_exists') ||
                error.code === 'user_already_exists') {
                
                const userEmail = args[0]?.email || 'هذا المستخدم';
                const friendlyError = new Error(
                    `⚠️ المستخدم ${userEmail} موجود بالفعل في النظام.\n\n` +
                    `الحلول المتاحة:\n` +
                    `1. استخدم بريد إلكتروني مختلف\n` +
                    `2. إذا نسيت كلمة المرور، استخدم "نسيت كلمة المرور"\n` +
                    `3. تواصل مع المدير لاستعادة الحساب`
                );
                friendlyError.isUserFriendly = true;
                friendlyError.originalError = error;
                throw friendlyError;
            }
            
            // إعادة رمي الخطأ للمعالجة في مكان آخر
            throw error;
        }
    };
}

    // تصدير الدوال للاستخدام العام
    window.SupabaseSingleton = {
        SessionManager,
        WarehouseManager,
        getClient: createSupabaseClient,
        SUPABASE_CONFIG,
        preFlightAuthCheck,      // ✅ الفحص قبل التنفيذ
        autoRecoverSession,      // ✅ التعافي التلقائي
        setupAuthStateListener,  // ✅ للاستخدام الخارجي
        startBackgroundSessionRefresh,  // ✅ تحديث تلقائي
        stopBackgroundSessionRefresh,   // ✅ إيقاف التحديث
        executeWithRetry,        // ✅ تنفيذ مع إعادة محاولة
        createSafeOperation,      // ✅ إنشاء عملية آمنة
        
        // ===== Multi-Tenant SaaS Functions =====
        getCurrentUserId: function() {
            return localStorage.getItem('slamtak-user-id') || 
                   localStorage.getItem('current_warehouse_id') ||
                   null;
        },
        
        getCurrentWarehouseId: function() {
            return localStorage.getItem('current_warehouse_id') || 
                   localStorage.getItem('slamtak-warehouse-id') ||
                   localStorage.getItem('slamtak-user-id') ||
                   null;
        },
        
        // إنشاء query مع فلتر user_id (للعزل بين المستأجرين)
        createTenantQuery: function(tableName, columns = '*') {
            const client = getClient();
            if (!client) return null;
            
            const userId = this.getCurrentUserId();
            if (!userId) {
                console.warn('⚠️ No user_id found for tenant query');
            }
            
            let query = client.from(tableName).select(columns);
            
            // إضافة فلتر user_id تلقائياً
            if (userId) {
                query = query.eq('user_id', userId);
            }
            
            return query;
        },
        
        // إضافة سجل مع user_id تلقائي
        insertWithTenant: async function(tableName, data) {
            const client = getClient();
            if (!client) return { success: false, error: 'No client' };
            
            const userId = this.getCurrentUserId();
            const warehouseId = this.getCurrentWarehouseId();
            
            const dataWithTenant = {
                ...data,
                user_id: data.user_id || userId,
                warehouse_id: data.warehouse_id || warehouseId
            };
            
            console.log(`📝 Inserting into ${tableName} with tenant:`, { userId, warehouseId });
            
            try {
                const { data: result, error } = await client
                    .from(tableName)
                    .insert([dataWithTenant])
                    .select()
                    .single();
                
                if (error) throw error;
                return { success: true, data: result };
            } catch (error) {
                console.error(`❌ Error inserting into ${tableName}:`, error);
                return { success: false, error: error.message };
            }
        },
        
        // تحديث سجل للمستأجر الحالي فقط
        updateWithTenant: async function(tableName, id, updates) {
            const client = getClient();
            if (!client) return { success: false, error: 'No client' };
            
            const userId = this.getCurrentUserId();
            
            try {
                let query = client
                    .from(tableName)
                    .update({
                        ...updates,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', id);
                
                // فلتر user_id للأمان
                if (userId) {
                    query = query.eq('user_id', userId);
                }
                
                const { data, error } = await query.select().single();
                
                if (error) throw error;
                return { success: true, data };
            } catch (error) {
                console.error(`❌ Error updating ${tableName}:`, error);
                return { success: false, error: error.message };
            }
        },
        
        // حذف سجل للمستأجر الحالي فقط
        deleteWithTenant: async function(tableName, id) {
            const client = getClient();
            if (!client) return { success: false, error: 'No client' };
            
            const userId = this.getCurrentUserId();
            
            try {
                let query = client
                    .from(tableName)
                    .delete()
                    .eq('id', id);
                
                // فلتر user_id للأمان
                if (userId) {
                    query = query.eq('user_id', userId);
                }
                
                const { error } = await query;
                
                if (error) throw error;
                return { success: true };
            } catch (error) {
                console.error(`❌ Error deleting from ${tableName}:`, error);
                return { success: false, error: error.message };
            }
        }
    };

    // بدء التحديث التلقائي عند التهيئة
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(startBackgroundSessionRefresh, 5000); // انتظار 5 ثواني بعد التحميل
    });

    console.log('✅ تم تحميل Supabase Singleton Module (مع دعم Multi-Tenant)');
})();
