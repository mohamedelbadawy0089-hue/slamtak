// ============================================================
// نظام المخزن الأوتوماتيكي الكامل - JavaScript
// ============================================================
// هذا الملف يحتوي على كل ما تحتاجه في الواجهة الأمامية:
// 1. دالة التسجيل مع إنشاء مخزن أوتوماتيكي
// 2. دالة تسجيل الدخول مع جلب معرف المخزن
// 3. دالة جلب معرف المخزن للمستخدم الحالي
// 4. دالة إصلاح localStorage
// 5. دالة الحذف الآمن للمنتجات
// ============================================================

// ============================================================
// 1. دالة التسجيل مع إنشاء مخزن أوتوماتيكي
// ============================================================
/**
 * تسجيل مستخدم جديد وإنشاء مخزن تلقائياً له
 * @param {Object} userData - بيانات المستخدم
 * @param {string} userData.email - البريد الإلكتروني
 * @param {string} userData.password - كلمة المرور
 * @param {string} userData.phone - رقم الهاتف (اختياري)
 * @param {Object} userData.metadata - بيانات إضافية (اختياري)
 * @returns {Promise<Object>} - نتيجة العملية
 */
async function signUpWithAutoWarehouse(userData) {
    const {
        email,
        password,
        phone = null,
        metadata = {}
    } = userData;

    try {
        console.log('🔄 Starting registration process...');

        // 1. تسجيل المستخدم في Supabase Auth
        const { data: authData, error: authError } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: {
                    phone,
                    ...metadata
                }
            }
        });

        if (authError) {
            throw new Error(`فشل التسجيل: ${authError.message}`);
        }

        if (!authData.user) {
            throw new Error('فشل إنشاء المستخدم');
        }

        const userId = authData.user.id;
        console.log('✅ User created in Supabase Auth:', userId);

        // 2. محاولة تسجيل الدخول تلقائياً إذا لم تكن هناك جلسة
        if (!authData.session) {
            console.log('🔄 No session returned, attempting sign in...');
            const { data: signInData, error: signInError } = await supabaseClient.auth.signInWithPassword({
                email,
                password
            });

            if (!signInError && signInData.session) {
                authData.session = signInData.session;
                console.log('✅ Auto sign-in successful');
            }
        }

        // 3. استدعاء RPC function لإنشاء سجل المستخدم والمخزن
        console.log('🏭 Setting up user and warehouse...');
        const { data: setupData, error: setupError } = await supabaseClient.rpc('setup_user_after_signup', {
            p_user_id: userId,
            p_email: email,
            p_phone: phone
        });

        if (setupError) {
            console.error('Setup Error:', setupError);
            // نستمر لأن التسجيل تم بنجاح، لكن نحذر المستخدم
            return {
                success: true,
                user: authData.user,
                warehouse_id: null,
                warning: 'تم التسجيل بنجاح، لكن حدث خطأ في إعداد المخزن',
                setup_error: setupError.message
            };
        }

        if (!setupData.success) {
            console.error('Setup failed:', setupData.error);
            return {
                success: true,
                user: authData.user,
                warehouse_id: null,
                warning: 'تم التسجيل بنجاح، لكن فشل إعداد المخزن',
                setup_error: setupData.error
            };
        }

        console.log('✅ User and warehouse setup completed:', setupData);

        // 4. حفظ معرف المخزن في localStorage
        const warehouseId = setupData.warehouse_id;
        if (warehouseId) {
            saveWarehouseIdToLocalStorage(warehouseId);
        }

        // نجاح العملية
        return {
            success: true,
            user: authData.user,
            warehouse_id: warehouseId,
            is_new_warehouse: setupData.is_new,
            message: setupData.message || 'تم التسجيل وإنشاء المخزن بنجاح'
        };

    } catch (error) {
        console.error('❌ Registration error:', error);
        return {
            success: false,
            error: error.message,
            message: 'فشل التسجيل أو إنشاء المخزن'
        };
    }
}

// ============================================================
// 2. دالة تسجيل الدخول مع جلب معرف المخزن
// ============================================================
/**
 * تسجيل الدخول وجلب معرف المخزن تلقائياً
 * @param {string} email - البريد الإلكتروني
 * @param {string} password - كلمة المرور
 * @returns {Promise<Object>} - نتيجة العملية
 */
async function signInWithWarehouseId(email, password) {
    try {
        console.log('🔄 Starting sign in process...');

        // 1. تسجيل الدخول
        const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (authError) {
            throw new Error(`فشل تسجيل الدخول: ${authError.message}`);
        }

        if (!authData.user) {
            throw new Error('فشل تسجيل الدخول');
        }

        console.log('✅ Sign in successful:', authData.user.id);

        // 2. جلب معرف المخزن تلقائياً
        const warehouseId = await getWarehouseIdFromServer();

        if (warehouseId) {
            saveWarehouseIdToLocalStorage(warehouseId);
            console.log('✅ Warehouse ID saved to localStorage:', warehouseId);
        } else {
            console.warn('⚠️ No warehouse found for user');
        }

        return {
            success: true,
            user: authData.user,
            warehouse_id: warehouseId,
            message: warehouseId ? 'تم تسجيل الدخول وجلب معرف المخزن' : 'تم تسجيل الدخول، لكن لم يتم العثور على مخزن'
        };

    } catch (error) {
        console.error('❌ Sign in error:', error);
        return {
            success: false,
            error: error.message,
            message: 'فشل تسجيل الدخول'
        };
    }
}

// ============================================================
// 3. دالة جلب معرف المخزن من السيرفر
// ============================================================
/**
 * جلب معرف المخزن للمستخدم الحالي من السيرفر
 * @returns {Promise<string|null>} - معرف المخزن أو null
 */
async function getWarehouseIdFromServer() {
    try {
        const { data: warehouseId, error } = await supabaseClient.rpc('get_user_warehouse_id');

        if (error) {
            console.error('Error getting warehouse ID:', error);
            return null;
        }

        return warehouseId;
    } catch (error) {
        console.error('Error in getWarehouseIdFromServer:', error);
        return null;
    }
}

// ============================================================
// 4. دالة حفظ معرف المخزن في localStorage
// ============================================================
/**
 * حفظ معرف المخزن في جميع مفاتيح localStorage المطلوبة
 * @param {string} warehouseId - معرف المخزن
 */
function saveWarehouseIdToLocalStorage(warehouseId) {
    if (!warehouseId) return;

    const keys = [
        'currentWarehouseId',
        'current_warehouse_id',
        'slamtak-warehouse-id',
        'warehouse_id'
    ];

    keys.forEach(key => {
        localStorage.setItem(key, warehouseId);
    });

    console.log('✅ Warehouse ID saved to all localStorage keys:', warehouseId);
}

// ============================================================
// 5. دالة إصلاح localStorage
// ============================================================
/**
 * إصلاح localStorage بمعرف المخزن الصحيح من السيرفر
 * @returns {Promise<Object>} - نتيجة العملية
 */
async function fixLocalStorageWarehouseId() {
    try {
        console.log('🔧 Starting localStorage fix...');

        // الحصول على معرف المخزن من السيرفر
        const warehouseId = await getWarehouseIdFromServer();

        if (!warehouseId) {
            return {
                success: false,
                error: 'No warehouse found for current user'
            };
        }

        // تحديث localStorage
        saveWarehouseIdToLocalStorage(warehouseId);

        return {
            success: true,
            warehouse_id: warehouseId,
            message: 'تم تحديث localStorage بنجاح. قم بتحديث الصفحة.'
        };

    } catch (error) {
        console.error('Error fixing localStorage:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// ============================================================
// 6. دالة الحذف الآمن للمنتجات
// ============================================================
/**
 * حذف جميع منتجات المخزن الحالي
 * @param {string} warehouseId - معرف المخزن (اختياري، سيتم جلبه تلقائياً)
 * @returns {Promise<Object>} - نتيجة العملية
 */
async function deleteAllWarehouseProducts(warehouseId = null) {
    try {
        console.log('🗑️ Starting product deletion...');

        // إذا لم يتم توفير معرف المخزن، السيرفر سيجلبه تلقائياً
        const { data: result, error } = await supabaseClient.rpc('delete_all_warehouse_products', {
            p_warehouse_id: warehouseId // يمكن أن يكون null
        });

        if (error) {
            throw new Error(`فشل الحذف: ${error.message}`);
        }

        if (!result.success) {
            throw new Error(result.error || 'فشل الحذف');
        }

        console.log('✅ Products deleted successfully:', result.deleted_count);

        return {
            success: true,
            deleted_count: result.deleted_count,
            warehouse_id: result.warehouse_id,
            message: `تم حذف ${result.deleted_count} منتج بنجاح`
        };

    } catch (error) {
        console.error('❌ Deletion error:', error);
        return {
            success: false,
            error: error.message,
            message: 'فشل حذف المنتجات'
        };
    }
}

// ============================================================
// 7. دالة تحميل مبدئي عند فتح التطبيق
// ============================================================
/**
 * تهيئة التطبيق عند التحميل - تضمن وجود معرف مخزن صحيح
 * @returns {Promise<Object>} - نتيجة التهيئة
 */
async function initializeApp() {
    try {
        console.log('🚀 Initializing app...');

        // التحقق من وجود جلسة
        const { data: { session } } = await supabaseClient.auth.getSession();

        if (!session) {
            console.log('ℹ️ No active session');
            return {
                success: true,
                authenticated: false,
                message: 'No active session'
            };
        }

        console.log('✅ Active session found:', session.user.id);

        // جلب معرف المخزن
        let warehouseId = await getWarehouseIdFromServer();

        if (!warehouseId) {
            console.warn('⚠️ No warehouse found, attempting to create one...');
            
            // محاولة إنشاء مخزن
            const { data: setupData, error: setupError } = await supabaseClient.rpc('setup_user_after_signup', {
                p_user_id: session.user.id,
                p_email: session.user.email,
                p_phone: session.user.phone
            });

            if (!setupError && setupData.success) {
                warehouseId = setupData.warehouse_id;
                console.log('✅ Warehouse created:', warehouseId);
            }
        }

        if (warehouseId) {
            saveWarehouseIdToLocalStorage(warehouseId);
            console.log('✅ App initialized with warehouse ID:', warehouseId);
        } else {
            console.warn('⚠️ App initialized without warehouse ID');
        }

        return {
            success: true,
            authenticated: true,
            warehouse_id: warehouseId,
            message: warehouseId ? 'تم تهيئة التطبيق بنجاح' : 'تم تهيئة التطبيق بدون مخزن'
        };

    } catch (error) {
        console.error('❌ Initialization error:', error);
        return {
            success: false,
            error: error.message,
            message: 'فشل تهيئة التطبيق'
        };
    }
}

// ============================================================
// 8. تصدير الدوال للاستخدام في الملفات الأخرى
// ============================================================
export {
    signUpWithAutoWarehouse,
    signInWithWarehouseId,
    getWarehouseIdFromServer,
    saveWarehouseIdToLocalStorage,
    fixLocalStorageWarehouseId,
    deleteAllWarehouseProducts,
    initializeApp
};

// ============================================================
// مثال على الاستخدام
// ============================================================

/*
// مثال 1: التسجيل مع إنشاء مخزن
const registrationResult = await signUpWithAutoWarehouse({
    email: 'user@example.com',
    password: 'securePassword123',
    phone: '+966501234567',
    metadata: {
        warehouse_name: 'مخزني الرئيسي',
        governorate: 'الرياض'
    }
});

if (registrationResult.success) {
    console.log('✅ Registration successful:', registrationResult.warehouse_id);
}

// مثال 2: تسجيل الدخول مع جلب معرف المخزن
const loginResult = await signInWithWarehouseId('user@example.com', 'securePassword123');

if (loginResult.success) {
    console.log('✅ Login successful:', loginResult.warehouse_id);
}

// مثال 3: إصلاح localStorage
const fixResult = await fixLocalStorageWarehouseId();

if (fixResult.success) {
    console.log('✅ localStorage fixed:', fixResult.warehouse_id);
    location.reload(); // تحديث الصفحة
}

// مثال 4: حذف جميع المنتجات
const deleteResult = await deleteAllWarehouseProducts();

if (deleteResult.success) {
    console.log('✅ Products deleted:', deleteResult.deleted_count);
}

// مثال 5: تهيئة التطبيق عند التحميل
const initResult = await initializeApp();

if (initResult.success) {
    console.log('✅ App initialized:', initResult.warehouse_id);
}
*/