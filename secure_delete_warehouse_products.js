// ============================================================
// كود JavaScript آمن لحذف جميع منتجات المخزن الحالي
// ============================================================
// الأمان:
// 1. التحقق من تسجيل دخول المستخدم
// 2. طلب تأكيد مزدوج من المستخدم
// 3. استخدام RPC function آمنة مع التحقق من الملكية
// 4. تحديث الواجهة فوراً بعد الحذف
// 5. معالجة جميع الأخطاء بشكل واضح
// ============================================================

/**
 * دالة مسح كافة المنتجات من المخزن الحالي مع أعلى معايير الأمان
 * تستخدم RPC function آمنة تتحقق من ملكية المستخدم للمخزن
 */
async function deleteAllWarehouseDrugs() {
    try {
        console.log('🔍 deleteAllWarehouseDrugs called');
        const warehouse_id = await getWarehouseId();
        console.log('🔍 warehouse_id:', warehouse_id);

        if (warehouse_id === null) {
            alert('جاري تهيئة المخزن...');
            return;
        }

        // التأكيد الأول
        const firstConfirm = confirm(
            '⚠️ تحذير شديد: أنت على وشك مسح جميع المنتجات من مخزنك الحالي!\n\n' +
            'هذا الإجراء سيحذف جميع الأدوية والمنتجات من المخزن نهائياً.\n' +
            'لا يمكن التراجع عن هذا الإجراء.\n\n' +
            'هل أنت متأكد تماماً أنك تريد المتابعة؟'
        );

        if (!firstConfirm) {
            console.log('🔍 User cancelled first confirmation');
            return;
        }

        // التأكيد النهائي
        const finalConfirm = confirm(
            '🚨 تأكيد نهائي:\n\n' +
            'سيتم مسح جميع المنتجات من المخزن الحالي (ID: ' + warehouse_id + ')\n\n' +
            'هل تريد حقاً تنفيذ هذا الإجراء؟\n\n' +
            'اضغط "موافق" للمسح النهائي أو "إلغاء" للتراجع.'
        );

        if (!finalConfirm) {
            console.log('🔍 User cancelled final confirmation');
            alert('تم إلغاء العملية. لم يتم مسح أي منتجات.');
            return;
        }

        let totalDeleted = 0;
        let lastError = null;

        console.log('🔍 Executing delete via secure RPC delete_all_warehouse_products');

        try {
            // استدعاء RPC function الآمنة
            const { data: rpcResult, error: rpcError } = await supabaseClient
                .rpc('delete_all_warehouse_products', {
                    p_warehouse_id: warehouse_id
                });

            if (rpcError) {
                console.warn(`⚠️ RPC error:`, rpcError);
                lastError = rpcError;
                throw new Error(`فشل الحذف عبر RPC: ${rpcError.message}`);
            }

            if (rpcResult && rpcResult.success === false) {
                console.warn(`⚠️ RPC returned failure:`, rpcResult);
                lastError = { 
                    message: rpcResult.error || 'Unknown RPC error', 
                    code: rpcResult.sqlstate || 'UNKNOWN' 
                };
                
                // رسائل خطأ محددة بناءً على نوع الخطأ من السيرفر
                if (rpcResult.error === 'User not authenticated') {
                    throw new Error('يجب تسجيل الدخول أولاً لحذف المنتجات');
                } else if (rpcResult.error === 'Warehouse not found') {
                    throw new Error('المخزن غير موجود. يرجى التأكد من اختيار المخزن الصحيح');
                } else if (rpcResult.error === 'Access denied: You do not own this warehouse') {
                    throw new Error('غير مسموح لك بحذف منتجات هذا المخزن. هذا المخزن لا يخص حسابك');
                }
                
                throw new Error(`فشل الحذف عبر RPC: ${rpcResult.error}`);
            }

            if (rpcResult && rpcResult.success === true) {
                totalDeleted = rpcResult.deleted_count || 0;
                console.log(`✅ RPC deleted ${totalDeleted} rows`);
                console.log(`✅ User ID: ${rpcResult.user_id}`);
                // انتظار قصير لضمان اكتمال العملية
                await new Promise(r => setTimeout(r, 200));
            }
        } catch (loopError) {
            console.warn(`⚠️ Delete error:`, loopError);
            lastError = loopError;
            throw loopError;
        }

        // التحقق من نجاح الحذف
        if (lastError && totalDeleted === 0) {
            console.error('❌ RPC delete error:', lastError);
            throw new Error(
                'فشل الحذف عبر RPC: ' + (lastError.message || lastError) +
                '. يرجى المحاولة مرة أخرى أو التواصل مع الدعم الفني.'
            );
        }

        if (lastError && totalDeleted > 0) {
            console.warn(`⚠️ Delete partially completed. ${totalDeleted} rows deleted before final error:`, lastError);
        }

        console.log('🔍 Final total deleted:', totalDeleted, 'products');

        // تحديث الواجهة فوراً
        allDrugs = [];
        currentOffset = 0;
        hasMoreData = true;

        if (gridApi) {
            gridApi.setGridOption('rowData', []);
        }
        updateUI();
        await updateWarehouseCounter();

        // رسالة النجاح
        const partialWarn = lastError
            ? '\n\n⚠️ ملاحظة: واجهت العملية مشكلة بعد حذف بعض الصفوف. تم حذف ما تم حذفه بنجاح. يُرجى المحاولة مرة أخرى لحذف أي صفوف متبقية.'
            : '';

        alert(
            '✅ تم مسح المنتجات من المخزن الحالي بنجاح.\n' +
            'عدد المنتجات المحذوفة: ' + totalDeleted.toLocaleString() +
            partialWarn
        );
    } catch (error) {
        console.error('خطأ في مسح جميع المنتجات:', error);
        alert('❌ حدث خطأ أثناء مسح جميع المنتجات: ' + (error.message || error));
    }
}

// ============================================================
// مثال على كيفية استخدام الدالة مع زر HTML
// ============================================================
/*
<button onclick="deleteAllWarehouseDrugs()" 
        style="background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%); 
               color: white; 
               padding: 12px 24px; 
               border: none; 
               border-radius: 6px; 
               font-weight: bold; 
               cursor: pointer; 
               box-shadow: 0 2px 4px rgba(244, 67, 54, 0.3);">
    🗑️ مسح جميع المنتجات
</button>
*/
