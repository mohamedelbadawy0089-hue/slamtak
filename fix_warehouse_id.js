// ============================================================
// سكريبت JavaScript لإصلاح معرف المخزن في localStorage
// ============================================================
// هذا السكريبت يمكن نسخه ولصقه في وحدة التحكم (Console)
// لتحديث localStorage بالمعرف الصحيح للمخزن
// ============================================================

async function fixWarehouseId() {
    try {
        console.log('🔧 بدء إصلاح معرف المخزن...');
        
        // التحقق من وجود Supabase
        if (typeof supabaseClient === 'undefined') {
            console.error('❌ supabaseClient غير موجود');
            return;
        }

        // الحصول على الجلسة الحالية
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            console.error('❌ لا توجد جلسة نشطة');
            return;
        }

        console.log('👤 معرف المستخدم الحالي:', session.user.id);

        // الحصول على معرف المخزن الصحيح من السيرفر
        const { data: warehouseId, error } = await supabaseClient
            .rpc('get_user_warehouse_id');

        if (error) {
            console.error('❌ خطأ في الحصول على معرف المخزن:', error);
            return;
        }

        if (!warehouseId) {
            console.error('❌ لم يتم العثور على مخزن للمستخدم');
            return;
        }

        console.log('🏭 معرف المخزن الصحيح:', warehouseId);

        // تحديث localStorage بالمعرف الصحيح
        localStorage.setItem('currentWarehouseId', warehouseId);
        localStorage.setItem('current_warehouse_id', warehouseId);
        localStorage.setItem('slamtak-warehouse-id', warehouseId);
        localStorage.setItem('currentWarehouseId', warehouseId);

        console.log('✅ تم تحديث localStorage بنجاح!');
        console.log('🔄 قم بتحديث الصفحة لتطبيق التغييرات');

        // عرض القيم الحالية
        console.log('📋 القيم الحالية في localStorage:');
        console.log('  - currentWarehouseId:', localStorage.getItem('currentWarehouseId'));
        console.log('  - current_warehouse_id:', localStorage.getItem('current_warehouse_id'));
        console.log('  - slamtak-warehouse-id:', localStorage.getItem('slamtak-warehouse-id'));

    } catch (error) {
        console.error('❌ خطأ أثناء الإصلاح:', error);
    }
}

// ============================================================
// طريقة الاستخدام:
// 1. افتح وحدة التحكم (Console) في المتصفح
// 2. انسخ هذا الكود بالكامل
// 3. الصقه في وحدة التحكم واضغط Enter
// 4. قم بتحديث الصفحة
// ============================================================

// تنفيذ السكريبت
fixWarehouseId();