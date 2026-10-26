// ============================================
// Route Guard - حماية المسارات ومنع الوصول غير المصرح
// ============================================

class RouteGuard {
    constructor() {
        this.supabase = window.SupabaseSingleton?.getClient?.() || window.supabase;
        this.allowedPublicRoutes = ['/login.html', '/index.html', '/register.html', '/'];
        this.dashboardRoutes = ['/dashboard.html', '/products.html', '/pharmacies.html', '/warehouse.html'];
    }

    // 1. ✅ حماية المسارات - منع المستخدم غير المسجل
    async protectRoute() {
        const currentPath = window.location.pathname;
        const isPublicRoute = this.allowedPublicRoutes.some(route => 
            currentPath.endsWith(route) || currentPath === route
        );

        // التحقق من الجلسة
        const { data: { session }, error } = await this.supabase.auth.getSession();

        if (!session && !isPublicRoute) {
            console.log('🚫 Access denied: No active session');
            this.redirectToLogin();
            return false;
        }

        if (session && isPublicRoute && currentPath !== '/') {
            console.log('✅ User already logged in, redirecting to dashboard');
            this.redirectToDashboard();
            return false;
        }

        console.log('✅ Route access granted');
        return true;
    }

    // 2. ✅ التحقق من الهوية - استخدام auth.uid() فقط من Supabase
    async verifyIdentity() {
        const { data: { user }, error } = await this.supabase.auth.getUser();
        
        if (error || !user) {
            console.error('❌ Identity verification failed:', error?.message);
            this.redirectToLogin();
            return null;
        }

        // ✅ لا نسمح بأي ID من الروابط
        const urlParams = new URLSearchParams(window.location.search);
        const forbiddenParams = ['user_id', 'warehouse_id', 'auth_id', 'uid'];
        
        for (const param of forbiddenParams) {
            if (urlParams.has(param)) {
                console.error(`🚫 Forbidden parameter detected: ${param}`);
                this.redirectToLogin('invalid_params');
                return null;
            }
        }

        console.log('✅ Identity verified:', user.id);
        return user.id;  // ← فقط من Supabase Context
    }

    // 3. ✅ ربط RLS بالواجهة - التأكد من عدم طلب بيانات بـ user_id مختلف
    async fetchWithRLS(table, options = {}) {
        const currentUserId = await this.verifyIdentity();
        
        if (!currentUserId) {
            throw new Error('Authentication required');
        }

        // ✅ لا نسمح أبداً بتمرير user_id في الاستعلام
        const { user_id, warehouse_id, ...safeOptions } = options;
        
        if (user_id || warehouse_id) {
            console.error('🚫 Attempted to override user context');
            throw new Error('Cannot request data with different user context');
        }

        // ✅ RLS سيتولى الفلترة تلقائياً باستخدام auth.uid()
        const { data, error } = await this.supabase
            .from(table)
            .select(safeOptions.select || '*')
            .order(safeOptions.orderBy || 'created_at', { ascending: false });

        if (error) {
            console.error('❌ Fetch error:', error.message);
            throw error;
        }

        return { data, currentUserId };
    }

    // 4. ✅ التوجيه التلقائي
    redirectToLogin(reason = 'unauthorized') {
        console.log('🔄 Redirecting to login:', reason);
        const params = reason ? `?reason=${encodeURIComponent(reason)}` : '';
        window.location.href = `/login.html${params}`;
    }

    redirectToDashboard() {
        console.log('🔄 Redirecting to dashboard');
        window.location.href = '/dashboard.html';
    }

    redirectToHome() {
        console.log('🔄 Redirecting to home');
        window.location.href = '/index.html';
    }

    // 5. ✅ التحقق من محاولة الوصول لبيانات مخزن آخر
    async validateAccess(attemptedWarehouseId = null) {
        const currentUserId = await this.verifyIdentity();
        
        if (!currentUserId) {
            return false;
        }

        // إذا حاول المستخدم الوصول لـ ID مختلف
        if (attemptedWarehouseId && attemptedWarehouseId !== currentUserId) {
            console.error('🚫 Cross-warehouse access attempt detected!');
            console.error('   Current user:', currentUserId);
            console.error('   Attempted access:', attemptedWarehouseId);
            
            // توجيه فوري
            this.redirectToLogin('cross_access_denied');
            return false;
        }

        return true;
    }

    // 6. ✅ Middleware للاستخدام في بداية كل صفحة
    static async init() {
        const guard = new RouteGuard();
        
        // حماية المسار
        const hasAccess = await guard.protectRoute();
        if (!hasAccess) return false;

        // التحقق من الهوية
        const userId = await guard.verifyIdentity();
        if (!userId) return false;

        console.log('✅ RouteGuard initialized successfully');
        return { guard, userId };
    }
}

// تصدير للاستخدام
window.RouteGuard = RouteGuard;

// تشغيل تلقائي عند تحميل الصفحة
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => RouteGuard.init());
} else {
    RouteGuard.init();
}
