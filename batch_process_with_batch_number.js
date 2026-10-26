// كود JavaScript للتعامل مع اللصق السريع (Excel Paste) باستخدام دالة RPC
// المعتمدة على (اسم المنتج + رقم التشغيلة) كمفتاح أساسي

function requirePasteFn(name) {
    const fn = typeof window !== 'undefined' ? window[name] : undefined;
    if (typeof fn !== 'function') {
        throw new ReferenceError(name + ' is not defined. Load stock.html (or registerPasteGlobals) before batch_process_with_batch_number.js');
    }
    return fn;
}

// دالة معالجة دفعات المنتجات مع التحقق من (اسم المنتج + رقم التشغيلة)
async function processPasteWithBatchNumber() {
    if (typeof isProcessingQueue !== 'undefined' && isProcessingQueue) {
        return;
    }

    const saveButton = document.getElementById('savePastedDataButton');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = '⏳ جاري الحفظ...';
    }

    if (typeof isProcessingQueue !== 'undefined') {
        isProcessingQueue = true;
    }

    const getWarehouseIdFn = (typeof getWarehouseId === 'function')
        ? getWarehouseId
        : requirePasteFn('getWarehouseId');
    const exponentialBackoffFn = (typeof exponentialBackoff === 'function')
        ? exponentialBackoff
        : requirePasteFn('exponentialBackoff');
    const formatDateForDBFn = (typeof formatDateForDB === 'function')
        ? formatDateForDB
        : requirePasteFn('formatDateForDB');
    const updatePasteProgressFn = (typeof updatePasteProgress === 'function')
        ? updatePasteProgress
        : requirePasteFn('updatePasteProgress');
    const hidePasteProgressFn = (typeof hidePasteProgress === 'function')
        ? hidePasteProgress
        : requirePasteFn('hidePasteProgress');
    const fetchWarehouseDrugsFn = (typeof fetchWarehouseDrugs === 'function')
        ? fetchWarehouseDrugs
        : requirePasteFn('fetchWarehouseDrugs');

    try {
        const warehouse_id = await getWarehouseIdFn();
        if (!warehouse_id) {
            console.warn('No warehouse_id found, skipping save');
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = '💾 حفظ البيانات';
            }
            isProcessingQueue = false;
            return;
        }

        // جلب البيانات مباشرة من الذاكرة (rawPastedData)
        const dataToSave = window.rawPastedData || [];
        if (dataToSave.length === 0) {
            console.warn('No data in memory to save');
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = '💾 حفظ البيانات';
            }
            isProcessingQueue = false;
            return;
        }

        let totalProcessed = 0;
        let totalItems = dataToSave.length;
        let failedBatches = 0;
        let batchIndex = 0;
        const BATCH_SIZE = 500; // حجم الدفعة المحسّن

        // إظهار شريط التقدم في البداية
        updatePasteProgressFn(0, 0, totalItems);

        // حذف جميع الأدوية القديمة قبل بدء المعالجة (مرة واحدة فقط)
        console.log('🗑️ حذف جميع الأدوية القديمة قبل البدء...');
        const deleteResult = await exponentialBackoffFn(async () => {
            const { data, error } = await supabaseClient.rpc('delete_all_current_warehouse_drugs', {
                p_warehouse_id: warehouse_id
            });

            if (error) {
                throw error;
            }

            return data;
        });

        if (!deleteResult.success) {
            console.error('❌ خطأ في حذف الأدوية القديمة:', deleteResult.error);
            alert('حدث خطأ أثناء حذف البيانات القديمة: ' + deleteResult.error);
            isProcessingQueue = false;
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = '💾 حفظ البيانات';
            }
            return;
        }

        console.log('✅ تم حذف', deleteResult.deleted_count, 'دواء قديمة');

        const processBatch = async () => {
            if (dataToSave.length === 0) {
                isProcessingQueue = false;
                console.log('✅ تم معالجة جميع الدفعات');

                // إخفاء شريط التقدم
                hidePasteProgressFn();

                // إعادة جلب البيانات من Supabase لتحديث الجدول
                await fetchWarehouseDrugsFn();

                // تحديث الجدول بالبيانات المحدثة فوراً
                if (gridApi) {
                    gridApi.setGridOption('rowData', allDrugs);
                }

                // تعطيل زر الحفظ بعد الانتهاء من الحفظ
                if (saveButton) {
                    saveButton.disabled = true;
                    saveButton.style.background = 'linear-gradient(135deg, #cccccc 0%, #999999 100%)';
                    saveButton.style.color = '#666666';
                    saveButton.style.borderColor = '#999999';
                    saveButton.style.cursor = 'not-allowed';
                    saveButton.style.boxShadow = 'none';
                    saveButton.textContent = '💾 حفظ البيانات (معطل)';
                }

                // إظهار رسالة نجاح
                alert('✅ تم حفظ جميع البيانات بنجاح في قاعدة البيانات');
                return;
            }

            // معالجة دفعات محسّنة (Batches of 500) لتحسين الأداء
            const batch = dataToSave.splice(0, BATCH_SIZE);
            batchIndex++;

            // تحويل صيغة التواريخ في الدفعة مع Input Sanitization (معالجة مجدولة)
            const processedBatch = await new Promise(resolve => {
                setTimeout(() => {
                    const result = batch.map(item => ({
                        ...item,
                        production_date: formatDateForDBFn(item.production_date),
                        expiry_date: formatDateForDBFn(item.expiry_date)
                    }));
                    resolve(result);
                }, 0);
            });

            console.log('📤 إرسال دفعة', batchIndex, ':', processedBatch.length, 'عنصر');
            console.log('📦 محتوى الدفعة الأولى:', processedBatch[0]);
            console.log('🔑 warehouse_id:', warehouse_id);

            // استخدام RPC الجديد المخصص للتعامل مع (اسم المنتج + رقم التشغيلة)
            const result = await exponentialBackoffFn(async () => {
                const { data, error } = await supabaseClient.rpc('batch_process_drugs_with_batch_number', {
                    p_warehouse_id: warehouse_id,
                    p_drugs: processedBatch
                });

                if (error) {
                    console.error('❌ خطأ من Supabase RPC:', error);
                    throw error;
                }

                console.log('✅ نتيجة RPC:', data);
                return data;
            });

            if (!result || result.length === 0) {
                console.error('❌ خطأ في حفظ الدفعة: لم تُرجع البيانات');
                failedBatches++;

                if (failedBatches >= 3) {
                    console.error('فشلت 3 دفعات متتالية، التوقف');
                    isProcessingQueue = false;
                    if (saveButton) {
                        saveButton.disabled = false;
                        saveButton.textContent = '💾 حفظ البيانات';
                    }
                    return;
                }

                setTimeout(processBatch, 200);
                return;
            }

            const batchResult = result[0];
            console.log(`📊 الدفعة ${batchIndex}: inserted=${batchResult.inserted}, updated=${batchResult.updated}, skipped=${batchResult.skipped}`);

            if (batchResult.errors && batchResult.errors.length > 0) {
                console.warn('⚠️ أخطاء في الدفعة:', batchResult.errors);
            }

            failedBatches = 0;
            totalProcessed += (batchResult.inserted || 0) + (batchResult.updated || 0);

            // تحديث شريط التقدم
            updatePasteProgressFn(totalProcessed, batchIndex, totalItems);

            // استدعاء الدفعة التالية بعد فاصل للحفاظ على استجابة UI
            setTimeout(processBatch, 200);
        };

        // بدء معالجة الدفعات
        processBatch();

    } catch (error) {
        console.error('خطأ في معالجة البيانات:', error);
        alert('حدث خطأ أثناء معالجة البيانات: ' + error.message);
        hidePasteProgressFn();
        if (typeof isProcessingQueue !== 'undefined') {
            isProcessingQueue = false;
        }
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = '💾 حفظ البيانات';
        }
    }
}

// دالة مساعدة لتنسيق التاريخ لقاعدة البيانات
function formatDateForDB(dateString) {
    if (!dateString || dateString.trim() === '') {
        return null;
    }

    // إذا كان التاريخ بالفعل بصيغة YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dateRegex.test(dateString)) {
        return dateString;
    }

    // إذا كان التاريخ بصيغة MM/YYYY (مثل 09/2027)
    const mmYyyyRegex = /^(\d{2})\/(\d{4})$/;
    const mmYyyyMatch = dateString.match(mmYyyyRegex);
    if (mmYyyyMatch) {
        const month = mmYyyyMatch[1];
        const year = mmYyyyMatch[2];
        return `${year}-${month}-01`;
    }

    // إذا كان التاريخ بصيغة MM-YYYY (مثل 09-2027)
    const mmYyyyDashRegex = /^(\d{2})-(\d{4})$/;
    const mmYyyyDashMatch = dateString.match(mmYyyyDashRegex);
    if (mmYyyyDashMatch) {
        const month = mmYyyyDashMatch[1];
        const year = mmYyyyDashMatch[2];
        return `${year}-${month}-01`;
    }

    // محاولة تحويل التاريخ بصيغة DD-MM-YYYY
    const parts = dateString.split('-');
    if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }

    return null;
}

// دالة Exponential Backoff لإعادة المحاولة في حال فشل الاتصال
async function exponentialBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const delay = baseDelay * Math.pow(2, i);
            console.log(`⏳ Retry ${i + 1}/${maxRetries} after ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// تحديث زر الحفظ لاستخدام الدالة الجديدة
document.addEventListener('DOMContentLoaded', function() {
    const saveButton = document.getElementById('savePastedDataButton');
    if (saveButton) {
        // إزالة المستمع القديم إذا وجد
        const newButton = saveButton.cloneNode(true);
        saveButton.parentNode.replaceChild(newButton, saveButton);
        
        // إضافة المستمع الجديد
        newButton.addEventListener('click', function() {
            console.log('🧷 savePastedDataButton clicked - using batch_process_with_batch_number');
            processPasteWithBatchNumber();
        });
    }
});

console.log('✅ تم تحميل دالة processPasteWithBatchNumber للتعامل مع (اسم المنتج + رقم التشغيلة)');
window.processPasteWithBatchNumber = processPasteWithBatchNumber;