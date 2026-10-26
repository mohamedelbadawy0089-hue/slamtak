// استمارة تسجيل المخازن - مع نظام الهوية (Auth) - Multi-Tenant
document.addEventListener('DOMContentLoaded', async function() {
    console.log('📝 تهيئة استمارة تسجيل المخازن (Multi-Tenant Mode)');
    
    const form = document.getElementById('warehouseForm');
    if (!form) {
        console.error('❌ لم يتم العثور على استمارة التسجيل');
        return;
    }

    // معالجة تقديم الاستمارة
    form.addEventListener('submit', async function(e) {
        console.log('🔄 بدء معالجة استمارة التسجيل');
        e.preventDefault();

        // جمع البيانات من الاستمارة
        const formData = {
            name: document.getElementById('storeName').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            region: document.getElementById('governorate').value.trim(),
            email: document.getElementById('email').value.trim(),
            password: document.getElementById('password').value,
            confirm_password: document.getElementById('confirmPassword').value,
            admin_password: document.getElementById('adminPassword').value,
            confirm_admin_password: document.getElementById('confirmAdminPassword').value
        };

        console.log('📋 البيانات المدخلة:', formData);

        // فحص البيانات
        if (!formData.name || !formData.phone || !formData.email || !formData.password || !formData.admin_password) {
            showError('يرجى ملء جميع الحقول المطلوبة');
            return;
        }

        if (formData.phone.length !== 11) {
            showError('التليفون يجب أن يكون 11 رقم');
            return;
        }

        if (formData.password !== formData.confirm_password) {
            showError('كلمتا المرور غير متطابقتين');
            return;
        }

        if (formData.password.length < 8) {
            showError('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
            return;
        }

        // ✅ التحقق من تطابق كلمة سر المدير
        if (formData.admin_password !== formData.confirm_admin_password) {
            showAdminPasswordError('كلمتا سر المدير غير متطابقتين');
            return;
        }

        if (formData.admin_password.length < 6) {
            showError('كلمة سر المدير يجب أن تكون 6 أحرف على الأقل');
            return;
        }

        await registerWarehouse(formData);
    });

    console.log('✅ تم تهيئة استمارة التسجيل بنجاح');
});

// دالة تسجيل المخزن
async function registerWarehouse(formData) {
    try {
        console.log('🔐 جاري إنشاء حساب المستخدم...');
        
        // ✅ إنشاء معرف مخزن فريد مسبقاً للربط
        const warehouseId = crypto.randomUUID();

        // إنشاء حساب المستخدم في Supabase Auth مع البيانات الوصفية (Metadata)
        const authResult = await AuthManager.signUp(formData.email, formData.password, {
            name: formData.name,
            phone: formData.phone,
            region: formData.region,
            warehouse_id: warehouseId, // ✅ ضروري لمشغل الـ Database (Trigger)
            role: 'owner'
        });

        if (!authResult.success) {
            showError('فشل إنشاء الحساب: ' + authResult.error);
            return;
        }

        // ✅ محاولة تسجيل الدخول فوراً إذا لم يتم إرجاع جلسة
        if (!authResult.data.session) {
            console.log('🔄 No session returned, attempting sign in...');
            try {
                const signInResult = await window.supabaseClient.auth.signInWithPassword({
                    email: formData.email,
                    password: formData.password
                });
                if (!signInResult.error && signInResult.data.session) {
                    authResult.data.session = signInResult.data.session;
                    authResult.data.user = signInResult.data.user;
                    console.log('✅ Signed in successfully after registration');
                }
            } catch (e) {
                console.warn('⚠️ Could not auto-signin:', e);
            }
        }

        console.log('✅ تم إنشاء حساب المستخدم بنجاح:', authResult.data.user.id);

        // إنشاء سجل المخزن - التوافق مع الهيكل الجديد (Version 3)
        const warehouseData = {
            id: warehouseId,               // المعرف الذي ولّدناه للربط مع Profile
            user_id: authResult.data.user.id,
            warehouse_name: formData.name, // المفتاح الصحيح في الجدول
            phone_number: formData.phone,  // المفتاح الصحيح في الجدول
            governorate: formData.region,  // المفتاح الصحيح في الجدول
            email: formData.email,
            admin_key: formData.admin_password, 
            created_at: new Date().toISOString()
        };

        console.log('🔑 Admin key will be saved (regular data, not Auth account):', formData.admin_password ? '✅ Yes' : '❌ No');

        console.log('💾 جاري حفظ بيانات المخزن...');
        
        // حفظ بيانات المخزن
        const warehouseResult = await WarehouseManager.createWarehouse(warehouseData);
        
        if (!warehouseResult.success) {
            showError('فشل حفظ بيانات المخزن: ' + warehouseResult.error);
            return;
        }

        console.log('✅ تم حفظ بيانات المخزن بنجاح:', warehouseResult.data);

        // حفظ في localStorage
        localStorage.setItem('warehouseData', JSON.stringify({
            ...formData,
            user_id: authResult.data.user.id,
            warehouse_id: warehouseResult.data.id
        }));

        console.log('✅ تم حفظ نسخة احتياطية في localStorage');

        // تعيين المخزن كنشط
        WarehouseManager.setActiveWarehouse(warehouseResult.data.id);

        // ✅ حفظ جميع متغيرات الجلسة المحلية لضمان عدم المطالبة بتسجيل الدخول
        localStorage.setItem('slamtak-user-id', authResult.data.user.id);
        localStorage.setItem('slamtak-user-email', formData.email);
        localStorage.setItem('slamtak-auth-status', 'authenticated');
        localStorage.setItem('current_warehouse_id', warehouseResult.data.id);
        localStorage.setItem('slamtak-warehouse-id', warehouseResult.data.id);
        localStorage.setItem('localAuth', 'true');
        
        // حفظ بيانات تسجيل الدخول للهجين (Hybrid Auth)
        if (authResult.data.session) {
            const session = authResult.data.session;
            localStorage.setItem('slamtak-auth-token', JSON.stringify(session));
            localStorage.setItem('hybrid-auth-session', JSON.stringify(session));
            localStorage.setItem('hybrid-auth-user', JSON.stringify(authResult.data.user));
            localStorage.setItem('hybrid-auth-warehouse', warehouseResult.data.id);
        }
        
        const currentUserData = {
            id: authResult.data.user.id,
            email: formData.email,
            phone: formData.phone,
            warehouseId: warehouseResult.data.id,
            userType: 'admin'
        };
        
        localStorage.setItem('currentUser', JSON.stringify(currentUserData));
        sessionStorage.setItem('currentUser', JSON.stringify(currentUserData));

        // نجاح التسجيل
        alert('تم التسجيل بنجاح! تم إنشاء حسابك ومخزنك.');
        window.location.href = 'add-product.html';

    } catch (error) {
        console.error('❌ خطأ غير متوقع:', error);
        showError('حدث خطأ أثناء التسجيل: ' + error.message);
    }
}

// دالة عرض أخطاء كلمة سر المدير (التحقق المباشر)
function showAdminPasswordError(message) {
    const errorDiv = document.getElementById('adminPasswordError');
    if (errorDiv) {
        errorDiv.textContent = '⚠️ ' + message;
        errorDiv.style.display = 'block';
        errorDiv.style.color = '#dc3545';
        errorDiv.style.fontWeight = 'bold';
    }
    // إضافة تأثير بصري على الحقول
    const adminPass = document.getElementById('adminPassword');
    const confirmAdminPass = document.getElementById('confirmAdminPassword');
    if (adminPass) adminPass.style.borderColor = '#dc3545';
    if (confirmAdminPass) confirmAdminPass.style.borderColor = '#dc3545';
}

// دالة إخفاء خطأ كلمة سر المدير
function hideAdminPasswordError() {
    const errorDiv = document.getElementById('adminPasswordError');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
    // إعادة لون الحدود للوضع الطبيعي
    const adminPass = document.getElementById('adminPassword');
    const confirmAdminPass = document.getElementById('confirmAdminPassword');
    if (adminPass) adminPass.style.borderColor = '#28a745';
    if (confirmAdminPass) confirmAdminPass.style.borderColor = '#28a745';
}

// التحقق المباشر من تطابق كلمتا سر المدير
function validateAdminPasswordMatch() {
    const adminPass = document.getElementById('adminPassword')?.value || '';
    const confirmAdminPass = document.getElementById('confirmAdminPassword')?.value || '';

    // إذا كانت الحقول فارغة، لا نعرض خطأ
    if (!adminPass && !confirmAdminPass) {
        hideAdminPasswordError();
        return true;
    }

    // إذا كانت الكلمتان متطابقتين
    if (adminPass === confirmAdminPass && adminPass.length >= 6) {
        hideAdminPasswordError();
        const errorDiv = document.getElementById('adminPasswordError');
        if (errorDiv) {
            errorDiv.textContent = '✅ كلمتا سر المدير متطابقتان';
            errorDiv.style.display = 'block';
            errorDiv.style.color = '#28a745';
            errorDiv.style.fontWeight = 'bold';
        }
        return true;
    }

    // إذا كانت الكلمتان مختلفتات وتم إدخالهما بالكامل
    if (confirmAdminPass && adminPass !== confirmAdminPass) {
        showAdminPasswordError('كلمتا سر المدير غير متطابقتين');
        return false;
    }

    return true;
}

// دالة عرض الأخطاء العامة
function showError(message) {
    const errorDiv = document.getElementById('generalError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
    alert(message);
}

// ✅ إضافة مستمعي الأحداث للتحقق المباشر
document.addEventListener('DOMContentLoaded', function() {
    const adminPass = document.getElementById('adminPassword');
    const confirmAdminPass = document.getElementById('confirmAdminPassword');

    if (adminPass && confirmAdminPass) {
        adminPass.addEventListener('input', validateAdminPasswordMatch);
        confirmAdminPass.addEventListener('input', validateAdminPasswordMatch);
        adminPass.addEventListener('blur', validateAdminPasswordMatch);
        confirmAdminPass.addEventListener('blur', validateAdminPasswordMatch);
        console.log('✅ تم تفعيل التحقق المباشر لكلمتا سر المدير');
    }
});
