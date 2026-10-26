// Auth Guard Unified System - حماية الدخول الموحدة
// سلامتك - v10.1
// تم تغليف الكود كله في try/catch لمنع الصفحة البيضاء

try {

class AuthGuard {
    constructor() {
        this.supabaseUrl = 'https://iksjhjxwphmvthryfeae.supabase.co';
        this.supabaseKey = 'sb_publishable_0DUy2mtXS6m5S8PwTDAANQ_XWlzbu0G';
        this.supabase = null;
        this.currentUser = null;
        this.currentWarehouseId = null;
        this.isSessionActive = false;
        this.isInitialized = false;
        this.authListenerSet = false;
        this.pageActivated = false;
        
        // التحقق الفوري قبل أي شيء
        this.instantLocalCheck();
    }
    
    // حفظ الجلسة في localStorage
    saveSession(session) {
        try {
            if (!session || !session.access_token) {
                console.warn('⚠️ لا توجد جلسة لحفظها');
                return false;
            }
            
            const sessionData = {
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                expires_at: session.expires_at,
                user_id: session.user?.id,
                email: session.user?.email,
                timestamp: Date.now()
            };
            
            localStorage.setItem('supabase.auth.token', JSON.stringify(sessionData));
            console.log('💾 تم حفظ الجلسة في localStorage');
            return true;
        } catch (error) {
            console.error('❌ خطأ في حفظ الجلسة:', error);
            return false;
        }
    }
    
    // تحميل الجلسة من localStorage
    loadSession() {
        try {
            const storedSession = localStorage.getItem('supabase.auth.token');
            const storedUser = localStorage.getItem('currentUser');
            
            if (!storedSession || !storedUser) {
                console.log('ℹ️ لا توجد جلسة محفوظة');
                return null;
            }
            
            const sessionData = JSON.parse(storedSession);
            const userData = JSON.parse(storedUser);
            
            // التحقق من صلاحية الجلسة
            if (sessionData.access_token && userData.id) {
                console.log('✅ تم تحميل الجلسة من localStorage');
                return { session: sessionData, user: userData };
            }
            
            console.warn('⚠️ الجلسة المحفوظة غير صالحة');
            this.clearSession();
            return null;
            
        } catch (error) {
            console.error('❌ خطأ في تحميل الجلسة:', error);
            this.clearSession();
            return null;
        }
    }
    
    // مسح الجلسة من localStorage
    clearSession() {
        try {
            localStorage.removeItem('supabase.auth.token');
            localStorage.removeItem('currentUser');
            console.log('🗑️ تم مسح الجلسة من localStorage');
            return true;
        } catch (error) {
            console.error('❌ خطأ في مسح الجلسة:', error);
            return false;
        }
    }
    
    // التحقق من وجود جلسة صالحة
    hasValidSession() {
        const storedSession = localStorage.getItem('supabase.auth.token');
        const storedUser = localStorage.getItem('currentUser');
        
        if (!storedSession || !storedUser) {
            return false;
        }
        
        try {
            const sessionData = JSON.parse(storedSession);
            const userData = JSON.parse(storedUser);
            
            return !!(sessionData.access_token && userData.id);
        } catch (error) {
            return false;
        }
    }
    
    // التحقق الفوري من localStorage (قبل أي تهيئة)
    instantLocalCheck() {
        try {
            // التحقق الفوري من localStorage
            const storedSession = localStorage.getItem('supabase.auth.token');
            const storedUser = localStorage.getItem('currentUser');
            
            if (storedSession && storedUser) {
                try {
                    const sessionData = JSON.parse(storedSession);
                    const userData = JSON.parse(storedUser);
                    
                    // التحقق من صلاحية الجلسة
                    if (sessionData.access_token && userData.id) {
                        console.log('⚡ LocalSession موجودة - فتح الصفحة فوراً');
                        
                        // تعيين معلومات المستخدم فوراً
                        this.currentUser = userData;
                        this.currentWarehouseId = userData.warehouseId || userData.id;
                        this.isSessionActive = true;
                        
                        // تعيين المتغيرات العالمية
                        window.currentUser = userData;
                        window.currentWarehouseId = this.currentWarehouseId;
                        
                        // تنشيط فوري للصفحة بدون أي انتظار
                        this.activatePageImmediately();
                        this.pageActivated = true;
                        
                        // تهيئة النظام في الخلفية
                        setTimeout(() => this.initInBackground(), 100);
                        return;
                    }
                } catch (parseError) {
                    console.warn('⚠️ LocalSession غير صالحة، مسحها...');
                    localStorage.removeItem('supabase.auth.token');
                    localStorage.removeItem('currentUser');
                }
            }
            
            // لا يوجد session - تهيئة عادية
            this.init();
            
        } catch (error) {
            console.error('❌ خطأ في التحقق الفوري:', error);
            this.init();
        }
    }
    
    // التهيئة في الخلفية بعد تنشيط الصفحة
    async initInBackground() {
        if (this.isInitialized) return;
        
        try {
            // تهيئة Supabase مع التخزين التلقائي
            if (!window.supabase) {
                window.supabase = this.createSupabaseClient();
            }
            
            this.supabase = window.supabase;
            
            // التحقق من الجلسة في الخلفية
            await this.backgroundSessionCheck();
            
            // إعداد مستمع تغييرات التوثيق
            this.setupAuthListener();
            
            this.isInitialized = true;
            
        } catch (error) {
            console.error('❌ خطأ في التهيئة الخلفية:', error);
        }
    }
    
    // التحقق من الجلسة في الخلفية
    async backgroundSessionCheck() {
        try {
            const { data: { session }, error } = await Promise.race([
                this.supabase.auth.getSession(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ]);
            
            if (!error && session && session.user) {
                // تحديث معلومات المستخدم
                this.updateUserInfo(session);
                console.log('✅ تم تحديث معلومات المستخدم في الخلفية');
                
                // حفظ الجلسة في localStorage
                this.saveSession(session);
                
                // حفظ بيانات المستخدم
                localStorage.setItem('currentUser', JSON.stringify({
                    id: session.user.id,
                    email: session.user.email,
                    warehouseId: this.currentWarehouseId
                }));
                
            } else {
                // الجلسة غير صالحة - إخفاء الصفحة وتوجيه
                console.warn('⚠️ الجلسة غير صالحة');
                this.hidePageAndRedirect();
            }
            
        } catch (error) {
            console.warn('⚠️ خطأ في التحقق الخلفي:', error);
            // لا تفعل شيئاً - الصفحة مفتوحة بالفعل
        }
    }
    
    // تهيئة النظام العادية (للصفحات بدون جلسة)
    async init() {
        if (this.isInitialized) return;
        
        try {
            // تهيئة Supabase مع التخزين التلقائي
            if (!window.supabase) {
                window.supabase = this.createSupabaseClient();
            }
            
            this.supabase = window.supabase;
            
            // التحقق من الجلسة
            await this.normalSessionCheck();
            
            // إعداد مستمع تغييرات التوثيق
            this.setupAuthListener();
            
            this.isInitialized = true;
            
        } catch (error) {
            console.error('❌ خطأ في تهيئة Auth Guard:', error);
            this.lazyRedirectToLogin();
        }
    }
    
    // ✅ استخدام SupabaseSingleton بدلاً من إنشاء client جديد
    createSupabaseClient() {
        if (typeof window.SupabaseSingleton !== 'undefined') {
            console.log('✅ Auth Guard: استخدام SupabaseSingleton');
            return window.SupabaseSingleton.getClient();
        }
        console.warn('⚠️ SupabaseSingleton غير متوفر');
        return null;
    }
    
    // تنشيط الصفحة فوراً مع التحقق من سلامة الكود
    activatePageImmediately() {
        try {
            const body = document.body;
            if (body) {
                // التحقق من سلامة الكود قبل تنشيط الصفحة
                if (this.pageActivated) {
                    console.log('⚡ الصفحة نشطة بالفعل');
                    return;
                }
                
                // إزالة display: none فوراً
                body.classList.add('authenticated');
                body.style.display = 'block';
                
                // إظهار جميع العناصر المخفية فوراً
                const hiddenElements = body.querySelectorAll('[style*="display: none"]');
                hiddenElements.forEach(element => {
                    try {
                        element.style.display = '';
                    } catch (elementError) {
                        console.warn('⚠️ خطأ في إظهار العنصر:', elementError);
                    }
                });
                
                // إخفاء شاشة التحميل فوراً
                const loadingScreen = document.querySelector('.auth-loading');
                if (loadingScreen) {
                    loadingScreen.style.display = 'none';
                }
                
                this.pageActivated = true;
                console.log('⚡ الصفحة نشطة فوراً');
            } else {
                console.warn('⚠️ document.body غير متوفر');
                // إعادة المحاولة بعد 100 مللي ثانية
                setTimeout(() => this.activatePageImmediately(), 100);
            }
        } catch (error) {
            console.error('❌ خطأ في تنشيط الصفحة:', error);
            // إعادة المحاولة بعد 200 مللي ثانية
            setTimeout(() => this.activatePageImmediately(), 200);
        }
    }
    
    // تحديث معلومات المستخدم
    updateUserInfo(session) {
        this.currentUser = session.user;
        this.currentWarehouseId = session.user?.user_metadata?.warehouse_id || session.user.id;
        this.isSessionActive = true;
        
        // حفظ في window variables
        window.currentUser = this.currentUser;
        window.currentWarehouseId = this.currentWarehouseId;
    }
    
    // إخفاء الصفحة وتوجيه
    hidePageAndRedirect() {
        const body = document.body;
        if (body) {
            body.style.display = 'none';
        }
        
        setTimeout(() => {
            if (!window.location.pathname.includes('login.html')) {
                window.location.replace('login.html');
            }
        }, 100);
    }
    
    // التحقق العادي من الجلسة
    async normalSessionCheck() {
        try {
            const { data: { session }, error } = await Promise.race([
                this.supabase.auth.getSession(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Session check timeout')), 3000))
            ]);
            
            if (error) {
                console.error('❌ خطأ في التحقق من الجلسة:', error);
                this.lazyRedirectToLogin();
                return;
            }
            
            if (!session || !session.user) {
                this.lazyRedirectToLogin();
                return;
            }
            
            // الجلسة نشطة - تنشيط الصفحة
            this.updateUserInfo(session);
            this.activatePageImmediately();
            
        } catch (error) {
            console.error('❌ خطأ في التحقق العادي:', error);
            this.lazyRedirectToLogin();
        }
    }
    
    // إعداد مستمع تغييرات التوثيق
    setupAuthListener() {
        if (this.authListenerSet) return;
        
        this.supabase.auth.onAuthStateChange((event, session) => {
            console.log('🔄 تغيير حالة التوثيق:', event);
            
            if (event === 'SIGNED_IN' && session) {
                this.updateUserInfo(session);
                this.activatePageImmediately();
            } else if (event === 'SIGNED_OUT') {
                this.isSessionActive = false;
                this.hidePageAndRedirect();
            }
        });
        
        this.authListenerSet = true;
    }
    
    // التحويل المتأخر إلى صفحة الدخول
    lazyRedirectToLogin() {
        const isLoginPage = window.location.pathname.includes('login.html');
        
        if (!isLoginPage) {
            console.warn('⚠️ لا توجد جلسة نشطة - سيتم التوجيه');
        } else {
            console.log('ℹ️ لا توجد جلسة نشطة');
        }
        
        setTimeout(() => {
            if (!window.location.pathname.includes('login.html')) {
                window.location.replace('login.html');
            }
        }, 200);
    }
    
    // التوجيه إلى صفحة الدخول
    redirectToLogin() {
        this.lazyRedirectToLogin();
    }
    
    // تسجيل الخروج
    async signOut() {
        console.log('🚪 تسجيل الخروج اليدوي...');
        
        try {
            if (this.supabase) {
                const { error } = await this.supabase.auth.signOut();
                
                if (error) {
                    console.error('❌ خطأ في تسجيل الخروج:', error);
                }
            }
            
            // مسح البيانات
            this.currentUser = null;
            this.currentWarehouseId = null;
            this.isSessionActive = false;
            this.pageActivated = false;
            
            window.currentUser = null;
            window.currentWarehouseId = null;
            
            // مسح الجلسة من localStorage
            this.clearSession();
            
            this.hidePageAndRedirect();
            
        } catch (error) {
            console.error('❌ خطأ في تسجيل الخروج:', error);
            this.hidePageAndRedirect();
        }
    }
    
    // التحقق من الجلسة الحالية
    async getCurrentSession() {
        try {
            if (!this.supabase) return null;
            
            const { data: { session }, error } = await this.supabase.auth.getSession();
            
            if (error || !session || !session.user) {
                return null;
            }
            
            return session;
        } catch (error) {
            return null;
        }
    }
    
    // الحصول على معلومات المستخدم الحالي
    getCurrentUser() {
        return {
            user: this.currentUser,
            warehouseId: this.currentWarehouseId,
            isActive: this.isSessionActive
        };
    }
    
    // التحقق من صلاحية المستخدم
    hasPermission(permission) {
        if (!this.currentUser || !this.isSessionActive) return false;
        
        const permissions = this.currentUser?.user_metadata?.permissions || [];
        return permissions.includes(permission);
    }
    
    // التحقق السريع من الجلسة
    async quickSessionCheck() {
        try {
            const storedSession = localStorage.getItem('supabase.auth.token');
            return storedSession && storedSession.length > 0;
        } catch (error) {
            return false;
        }
    }
}

// إنشاء Auth Guard Global
window.authGuard = new AuthGuard();

// جعل الدوال متاحة عالمياً
window.signOut = () => window.authGuard.signOut();
window.getCurrentUser = () => window.authGuard.getCurrentUser();
window.hasPermission = (permission) => window.authGuard.hasPermission(permission);
window.getCurrentSession = () => window.authGuard.getCurrentSession();
window.quickSessionCheck = () => window.authGuard.quickSessionCheck();

console.log('⚡ Auth Guard System v10.1 مع التحقق الفوري جاهز للاستخدام');

// safety net لإظهار الصفحة في كل الحالات
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        try {
            if (document.body && document.body.style.display === 'none') {
                console.log('⚡ Safety Net: إظهار الصفحة');
                document.body.style.display = 'block';
                document.body.classList.add('authenticated');
            }
        } catch (e) {
            console.error('❌ خطأ في Safety Net:', e);
        }
    }, 500);
});

} catch (globalError) {
    console.error('❌ خطأ عالمي في Auth Guard:', globalError);
    // محاولة إظهار الصفحة حتى لو حصل خطأ
    try {
        if (document.body) {
            document.body.style.display = 'block';
        }
    } catch (e) {
        console.error('❌ خطأ في إظهار الصفحة:', e);
    }
}
