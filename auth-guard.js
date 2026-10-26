// ملاحظة: هذا الملف تم استبداله بـ supabase-singleton.js
// لا تستخدم هذا الملف anymore - استخدم SupabaseSingleton.SessionManager فقط
console.log('⚠️ auth-guard.js تم استبداله بـ supabase-singleton.js');

// تصدير فارغ لمنع الأخطاء
window.AuthGuard = {
    SessionManager: {
        checkSession: () => null,
        ensureAuthenticated: () => false,
        saveUserToStorage: () => {},
        getUserFromStorage: () => null,
        clearSession: () => {}
    }
};

// لا توجد رسالة 'لا توجد جلسة نشطة' هنا
console.log('✅ Auth Guard تم تعطيله - استخدم SupabaseSingleton فقط');
