// حل مشكلة حدود حجم البيانات في RPC Supabase
// هذا الملف يوفر حلولاً للتعامل مع الدفعات الكبيرة دون تجاوز حدود Payload Size

/**
 * حلول للتعامل مع حدود RPC في Supabase:
 * 1. تقسيم الدفعات إلى أحجام أصغر (Chunking)
 * 2. استخدام التحميل المتوازي (Parallel Processing)
 * 3. إضافة إعادة المحاولة مع التراجع الأسي (Exponential Backoff)
 * 4. التحقق من حجم البيانات قبل الإرسال
 */

// ============================================
// 1. دالة تقسيم الدفعات الذكية
// ============================================

/**
 * تقسيم البيانات إلى دفعات صغيرة لتجنب تجاوز حدود Payload Size
 * @param {Array} data - البيانات المراد تقسيمها
 * @param {number} maxChunkSize - الحد الأقصى لحجم الدفعة (عدد العناصر)
 * @param {number} maxPayloadSizeKB - الحد الأقصى لحجم البيانات بالكيلوبايت
 * @returns {Array} - مصفوفة من الدفعات
 */
function createSmartChunks(data, maxChunkSize = 500, maxPayloadSizeKB = 1000) {
    if (!data || data.length === 0) return [];
    
    const chunks = [];
    let currentChunk = [];
    let currentChunkSize = 0;
    
    for (const item of data) {
        // تقدير حجم العنصر بالبايت
        const itemSize = JSON.stringify(item).length;
        
        // التحقق من تجاوز الحدود
        if (currentChunk.length >= maxChunkSize || 
            (currentChunkSize + itemSize) > (maxPayloadSizeKB * 1024)) {
            
            if (currentChunk.length > 0) {
                chunks.push([...currentChunk]);
            }
            
            currentChunk = [item];
            currentChunkSize = itemSize;
        } else {
            currentChunk.push(item);
            currentChunkSize += itemSize;
        }
    }
    
    // إضافة الدفعة الأخيرة
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    
    console.log(`📊 تم تقسيم ${data.length} عنصر إلى ${chunks.length} دفعة`);
    return chunks;
}

// ============================================
// 2. دالة معالجة الدفعات مع التحكم في التحميل المتوازي
// ============================================

/**
 * معالجة الدفعات مع التحكم في التحميل المتوازي
 * @param {Array} chunks - الدفعات المراد معالجتها
 * @param {Function} processFn - دالة المعالجة
 * @param {Object} options - خيارات المعالجة
 * @returns {Promise<Object>} - نتيجة المعالجة
 */
async function processBatchesWithConcurrency(chunks, processFn, options = {}) {
    const {
        maxConcurrent = 3,
        maxRetries = 3,
        retryDelay = 1000,
        onProgress = null
    } = options;
    
    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    const results = [];
    const failedBatches = [];
    
    // معالجة الدفعات في مجموعات متوازية
    for (let i = 0; i < chunks.length; i += maxConcurrent) {
        const batchGroup = chunks.slice(i, i + maxConcurrent);
        
        // إنشاء وعود للمعالجة المتوازية
        const promises = batchGroup.map(async (chunk, index) => {
            const batchIndex = i + index;
            let retryCount = 0;
            
            while (retryCount <= maxRetries) {
                try {
                    console.log(`🔄 معالجة الدفعة ${batchIndex + 1}/${chunks.length} (حجم: ${chunk.length})`);
                    
                    const result = await processFn(chunk, batchIndex);
                    
                    processedCount += chunk.length;
                    successCount += chunk.length;
                    
                    // تحديث التقدم
                    if (onProgress) {
                        onProgress({
                            processed: processedCount,
                            total: chunks.reduce((sum, c) => sum + c.length, 0),
                            currentBatch: batchIndex + 1,
                            totalBatches: chunks.length,
                            success: successCount,
                            failed: failedCount
                        });
                    }
                    
                    return { success: true, batchIndex, result };
                    
                } catch (error) {
                    retryCount++;
                    
                    if (retryCount > maxRetries) {
                        console.error(`❌ فشل الدفعة ${batchIndex + 1} بعد ${maxRetries} محاولات:`, error.message);
                        failedCount += chunk.length;
                        failedBatches.push({ batchIndex, chunk, error: error.message });
                        return { success: false, batchIndex, error: error.message };
                    }
                    
                    // انتظار أسي قبل إعادة المحاولة
                    const delay = retryDelay * Math.pow(2, retryCount - 1);
                    console.log(`⏳ إعادة محاولة ${retryCount}/${maxRetries} للدفعة ${batchIndex + 1} بعد ${delay}ms`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        });
        
        // انتظار اكتمال المجموعة الحالية
        const batchResults = await Promise.allSettled(promises);
        results.push(...batchResults);
        
        // فحص إذا كانت هناك دفعات فاشلة بشكل دائم
        const permanentFailures = batchResults.filter(r => 
            r.status === 'fulfilled' && !r.value.success
        );
        
        if (permanentFailures.length > 0) {
            console.warn(`⚠️ ${permanentFailures.length} دفعة فشلت بشكل دائم في هذه المجموعة`);
        }
    }
    
    return {
        success: failedBatches.length === 0,
        processed: processedCount,
        successCount,
        failedCount,
        failedBatches,
        results: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason })
    };
}

// ============================================
// 3. دالة RPC محسنة مع تقسيم الدفعات
// ============================================

/**
 * دالة RPC محسنة مع تقسيم الدفعات للتعامل مع البيانات الكبيرة
 * @param {Array} products - المنتجات المراد حفظها
 * @param {string} warehouseId - معرف المخزن
 * @param {Object} options - خيارات المعالجة
 * @returns {Promise<Object>} - نتيجة العملية
 */
async function batchProcessDrugsEnhanced(products, warehouseId, options = {}) {
    const {
        maxChunkSize = 500,
        maxPayloadSizeKB = 1000,
        maxConcurrent = 3,
        maxRetries = 3,
        onProgress = null
    } = options;
    
    try {
        // التحقق من صحة البيانات
        if (!products || products.length === 0) {
            return { success: true, message: 'لا توجد بيانات للمعالجة', processed: 0 };
        }
        
        if (!warehouseId) {
            return { success: false, error: 'معرف المخزن مطلوب' };
        }
        
        console.log(`🚀 بدء معالجة ${products.length} منتج للمخزن ${warehouseId}`);
        
        // 1. تقسيم البيانات إلى دفعات ذكية
        const chunks = createSmartChunks(products, maxChunkSize, maxPayloadSizeKB);
        
        // 2. معالجة الدفعات مع التحميل المتوازي
        const result = await processBatchesWithConcurrency(chunks, async (chunk, batchIndex) => {
            // استخدام RPC مع التحقق من حجم البيانات
            const chunkSizeKB = JSON.stringify(chunk).length / 1024;
            
            if (chunkSizeKB > maxPayloadSizeKB) {
                throw new Error(`حجم الدفعة ${chunkSizeKB.toFixed(2)}KB يتجاوز الحد المسموح ${maxPayloadSizeKB}KB`);
            }
            
            // استدعاء RPC مع التحقق من الأخطاء
            const { data, error } = await supabaseClient.rpc('batch_process_drugs', {
                p_warehouse_id: warehouseId,
                p_drugs: chunk
            });
            
            if (error) {
                throw new Error(`خطأ RPC: ${error.message}`);
            }
            
            if (!data || !data.success) {
                throw new Error(`فشل المعالجة: ${data.error || 'سبب غير معروف'}`);
            }
            
            return data;
        }, {
            maxConcurrent,
            maxRetries,
            onProgress
        });
        
        // 3. تجميع النتائج
        const finalResult = {
            success: result.success,
            totalProducts: products.length,
            processed: result.processed,
            successCount: result.successCount,
            failedCount: result.failedCount,
            batchesProcessed: chunks.length,
            failedBatches: result.failedBatches.length
        };
        
        if (result.failedBatches.length > 0) {
            finalResult.failedBatchesDetails = result.failedBatches;
            finalResult.message = `تمت معالجة ${result.successCount} منتج بنجاح، فشل ${result.failedCount} منتج`;
        } else {
            finalResult.message = `✅ تمت معالجة جميع ${products.length} منتج بنجاح`;
        }
        
        console.log(`🏁 ${finalResult.message}`);
        return finalResult;
        
    } catch (error) {
        console.error('❌ خطأ في معالجة الدفعات:', error);
        return {
            success: false,
            error: error.message,
            processed: 0
        };
    }
}

// ============================================
// 4. دالة بديلة باستخدام INSERT مباشر للدفعات الكبيرة جداً
// ============================================

/**
 * دالة بديلة للتعامل مع البيانات الضخمة باستخدام INSERT مباشر
 * @param {Array} products - المنتجات المراد حفظها
 * @param {string} warehouseId - معرف المخزن
 * @param {Object} options - خيارات المعالجة
 * @returns {Promise<Object>} - نتيجة العملية
 */
async function bulkInsertProductsDirect(products, warehouseId, options = {}) {
    const {
        batchSize = 100,
        maxConcurrent = 2,
        onProgress = null
    } = options;
    
    try {
        // تقسيم البيانات إلى دفعات صغيرة
        const chunks = [];
        for (let i = 0; i < products.length; i += batchSize) {
            chunks.push(products.slice(i, i + batchSize));
        }
        
        let processed = 0;
        const results = [];
        
        // معالجة الدفعات
        for (let i = 0; i < chunks.length; i += maxConcurrent) {
            const batchGroup = chunks.slice(i, i + maxConcurrent);
            
            const promises = batchGroup.map(async (chunk, index) => {
                const batchIndex = i + index;
                
                try {
                    // استخدام INSERT مباشر بدلاً من RPC
                    const { error } = await supabaseClient
                        .from('drugs')
                        .insert(chunk.map(product => ({
                            ...product,
                            warehouse_id: warehouseId,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        })));
                    
                    if (error) throw error;
                    
                    processed += chunk.length;
                    
                    if (onProgress) {
                        onProgress({
                            processed,
                            total: products.length,
                            currentBatch: batchIndex + 1,
                            totalBatches: chunks.length
                        });
                    }
                    
                    return { success: true, batchIndex, count: chunk.length };
                    
                } catch (error) {
                    console.error(`❌ فشل الدفعة ${batchIndex + 1}:`, error.message);
                    return { success: false, batchIndex, error: error.message };
                }
            });
            
            const batchResults = await Promise.allSettled(promises);
            results.push(...batchResults);
            
            // إضافة تأخير بسيط بين المجموعات
            if (i + maxConcurrent < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // حساب النتائج
        const successCount = results.filter(r => 
            r.status === 'fulfilled' && r.value.success
        ).reduce((sum, r) => sum + r.value.count, 0);
        
        const failedCount = products.length - successCount;
        
        return {
            success: failedCount === 0,
            totalProducts: products.length,
            processed: successCount,
            successCount,
            failedCount,
            batchesProcessed: chunks.length
        };
        
    } catch (error) {
        console.error('❌ خطأ في الإدراج المباشر:', error);
        return {
            success: false,
            error: error.message,
            processed: 0
        };
    }
}

// ============================================
// 5. دالة التحقق من حجم البيانات قبل الإرسال
// ============================================

/**
 * التحقق من حجم البيانات قبل إرسالها إلى RPC
 * @param {Array} data - البيانات المراد التحقق منها
 * @param {number} maxSizeKB - الحد الأقصى للحجم بالكيلوبايت
 * @returns {Object} - نتيجة التحقق
 */
function validatePayloadSize(data, maxSizeKB = 1000) {
    if (!data) {
        return { valid: false, error: 'البيانات غير موجودة' };
    }
    
    const jsonString = JSON.stringify(data);
    const sizeBytes = new Blob([jsonString]).size;
    const sizeKB = sizeBytes / 1024;
    
    return {
        valid: sizeKB <= maxSizeKB,
        sizeBytes,
        sizeKB: sizeKB.toFixed(2),
        maxSizeKB,
        isOverLimit: sizeKB > maxSizeKB,
        recommendation: sizeKB > maxSizeKB 
            ? `يجب تقسيم البيانات إلى دفعات أصغر (الحالي: ${sizeKB.toFixed(2)}KB، المسموح: ${maxSizeKB}KB)`
            : 'الحجم مقبول'
    };
}

// ============================================
// 6. دالة التكا��ل مع النظام الحالي
// ============================================

/**
 * دالة التكامل مع نظام الدفعات الحالي
 * تحل محل processPasteWithBatchNumber في التعامل مع الدفعات الكبيرة
 */
async function enhancedBatchProcessor(products, warehouseId, options = {}) {
    const {
        useDirectInsert = false, // استخدام INSERT مباشر للبيانات الضخمة
        maxChunkSize = 500,
        maxPayloadSizeKB = 1000,
        onProgress = null
    } = options;
    
    // التحقق من حجم البيانات الإجمالي
    const sizeCheck = validatePayloadSize(products, maxPayloadSizeKB * 10); // هامش أمان
    
    console.log('📊 تحليل حجم البيانات:', {
        totalProducts: products.length,
        ...sizeCheck
    });
    
    if (sizeCheck.isOverLimit || useDirectInsert) {
        console.log('🔄 استخدام الإدراج المباشر للبيانات الضخمة');
        return await bulkInsertProductsDirect(products, warehouseId, {
            batchSize: maxChunkSize,
            onProgress
        });
    } else {
        console.log('🔄 استخدام RPC مع تقسيم الدفعات');
        return await batchProcessDrugsEnhanced(products, warehouseId, {
            maxChunkSize,
            maxPayloadSizeKB,
            onProgress
        });
    }
}

// ============================================
// 7. تصدير الدوال للاستخدام العالمي
// ============================================

if (typeof window !== 'undefined') {
    window.BatchProcessor = {
        createSmartChunks,
        processBatchesWithConcurrency,
        batchProcessDrugsEnhanced,
        bulkInsertProductsDirect,
        validatePayloadSize,
        enhancedBatchProcessor
    };
    
    console.log('✅ تم تحميل BatchProcessor للتعامل مع حدود RPC Supabase');
}

// ============================================
// 8. مثال على الاستخدام
// ============================================

/*
// مثال على الاستخدام في نظام الدفعات الحالي:
async function processLargeBatch() {
    const products = [/* ... بيانات المنتجات ... *\/];
    const warehouseId = 'uuid-here';
    
    const result = await enhancedBatchProcessor(products, warehouseId, {
        maxChunkSize: 500,
        maxPayloadSizeKB: 1000,
        onProgress: (progress) => {
            console.log(`التقدم: ${progress.processed}/${progress.total} (${((progress.processed/progress.total)*100).toFixed(1)}%)`);
        }
    });
    
    if (result.success) {
        console.log(`✅ النجاح: ${result.message}`);
    } else {
        console.error(`❌ الفشل: ${result.error}`);
    }
}
*/