// ============================================================
// إنشاء مخزن تلقائياً عند تسجيل مستخدم جديد - JavaScript (معدل)
// ============================================================
// هذا الكود يستخدم RPC function آمنة بعد التسجيل الناجح
// لتجنب مشاكل trigger على auth.users
// ============================================================

import { supabase } from './supabaseClient'; // تأكد من استيراد عميل Supabase الخاص بك

/**
 * تسجيل مستخدم جديد وإنشاء مخزن تلقائياً له باستخدام RPC
 * @param {Object} userData - بيانات المستخدم
 * @param {string} userData.email - البريد الإلكتروني
 * @param {string} userData.password - كلمة المرور
 * @param {string} userData.phone - رقم الهاتف (اختياري)
 * @returns {Promise<Object>} - نتيجة العملية
 */
async function signUpWithAutoWarehouse(userData) {
  const {
    email,
    password,
    phone = null
  } = userData;

  try {
    // 1. تسجيل المستخدم في Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          phone // بيانات إضافية في auth.users
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

    // 2. استدعاء RPC function لإنشاء سجل المستخدم والمخزن
    const { data: setupData, error: setupError } = await supabase.rpc('setup_user_after_signup', {
      p_user_id: userId,
      p_email: email,
      p_phone: phone
    });

    if (setupError) {
      throw new Error(`فشل إعداد المستخدم والمخزن: ${setupError.message}`);
    }

    if (!setupData.success) {
      throw new Error(setupData.error || 'فشل إعداد المستخدم والمخزن');
    }

    // نجاح العملية
    return {
      success: true,
      user: authData.user,
      warehouse_id: setupData.warehouse_id,
      is_new_warehouse: setupData.is_new,
      message: setupData.message || 'تم التسجيل وإنشاء المخزن بنجاح'
    };

  } catch (error) {
    console.error('خطأ في التسجيل:', error);
    
    return {
      success: false,
      error: error.message,
      message: 'فشل التسجيل أو إنشاء المخزن'
    };
  }
}

/**
 * إعداد المستخدم والمخزن بعد التسجيل (للاستخدام اليدوي)
 * مفيدة إذا كنت تستخدم دالة تسجيل أخرى
 * @param {string} userId - معرف المستخدم
 * @param {string} email - البريد الإلكتروني
 * @param {string} phone - رقم الهاتف (اختياري)
 * @returns {Promise<Object>} - نتيجة العملية
 */
async function setupUserWarehouse(userId, email, phone = null) {
  try {
    const { data, error } = await supabase.rpc('setup_user_after_signup', {
      p_user_id: userId,
      p_email: email,
      p_phone: phone
    });

    if (error) {
      throw new Error(`فشل إعداد المستخدم: ${error.message}`);
    }

    return {
      success: data.success,
      warehouse_id: data.warehouse_id,
      is_new: data.is_new,
      message: data.message,
      error: data.error
    };
  } catch (error) {
    console.error('خطأ في إعداد المستخدم:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * جلب المخزن الافتراضي للمستخدم
 * @param {string} userId - معرف المستخدم
 * @returns {Promise<Object>} - نتيجة العملية
 */
async function getUserDefaultWarehouse(userId) {
  try {
    const { data: warehouse, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      throw new Error(`فشل جلب المخزن: ${error.message}`);
    }

    return {
      success: true,
      warehouse: warehouse
    };
  } catch (error) {
    console.error('خطأ في جلب المخزن:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================
// مثال على الاستخدام
// ============================================================

/*
// مثال 1: التسجيل مع إنشاء مخزن تلقائياً
const result = await signUpWithAutoWarehouse({
  email: 'user@example.com',
  password: 'securePassword123',
  phone: '+966501234567'
});

if (result.success) {
  console.log('تم التسجيل بنجاح!');
  console.log('المستخدم:', result.user);
  console.log('معرف المخزن:', result.warehouse_id);
  console.log('هل المخزن جديد؟', result.is_new_warehouse);
} else {
  console.error('فشل التسجيل:', result.error);
}

// مثال 2: إعداد مستخدم ومخزن يدوياً (بعد التسجيل)
const setupResult = await setupUserWarehouse(
  'user-uuid-here',
  'user@example.com',
  '+966501234567'
);

if (setupResult.success) {
  console.log('تم الإعداد بنجاح!');
  console.log('معرف المخزن:', setupResult.warehouse_id);
}

// مثال 3: جلب المخزن الافتراضي للمستخدم
const userId = 'user-uuid-here';
const warehouseResult = await getUserDefaultWarehouse(userId);

if (warehouseResult.success) {
  console.log('المخزن الافتراضي:', warehouseResult.warehouse);
}
*/

// ============================================================
// تصدير الدوال للاستخدام في الملفات الأخرى
// ============================================================
export { signUpWithAutoWarehouse, setupUserWarehouse, getUserDefaultWarehouse };
