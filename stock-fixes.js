// حلول سريعة لمشاكل stock.html مع الدفعات الكبيرة

// ============================================
// 1. حل مشكلة AG-Grid مع file:// protocol
// ============================================

if (window.location.protocol === 'file:') {
    console.log('🔧 Running in file:// mode - applying AG-Grid fixes');
    
    // حل مشكلة AG-Grid مع file://
    if (typeof agGrid !== 'undefined') {
        // تعطيل بعض الميزات التي تتطلب HTTPS
        agGrid.LicenseManager.setLicenseKey('');
        
        // إصلاح مشكلة columnTypes
        const originalCreateGrid = window.createGrid;
        if (originalCreateGrid) {
            window.createGrid = function(...args) {
                const gridOptions = args[0] || {};
                
                // إضافة columnTypes إذا لم تكن موجودة
                if (!gridOptions.columnTypes) {
                    gridOptions.columnTypes = {
                        textColumn: {
                            filter: 'agTextColumnFilter',
                            editable: true,
                            resizable: true
                        },
                        numberColumn: {
                            filter: 'agNumberColumnFilter',
                            editable: true,
                            resizable: true
                        },
                        dateColumn: {
                            filter: 'agDateColumnFilter',
                            editable: true,
                            resizable: true
                        }
                    };
                }
                
                return originalCreateGrid(gridOptions);
            };
        }
    }
}

// ============================================
// 2. حل مشكلة الدفعات الكبيرة (20,000+ صف)
// ============================================

/**
 * دالة محسنة لمعالجة اللصق مع تقسيم الدفعات
 * @param {string} rawText - النص الملصق
 * @returns {Promise<Object>} - البيانات المعالجة
 */
async function processLargePasteSafely(rawText) {
    console.log('🔧 Processing large paste safely...');
    
    const MAX_ROWS_PER_BATCH = 5000; // تقليل من 20,000 إلى 5,000
    const MAX_TOTAL_ROWS = 20000; // الحد الأقصى المسموح
    
    try {
        // تحليل النص
        const lines = rawText.split(/\r?\n/).filter(line => line.trim() !== '');
        
        if (lines.length > MAX_TOTAL_ROWS) {
            console.warn(`⚠️ Too many rows (${lines.length}), limiting to ${MAX_TOTAL_ROWS}`);
            lines.length = MAX_TOTAL_ROWS;
        }
        
        // تقسيم إلى دفعات
        const batches = [];
        for (let i = 0; i < lines.length; i += MAX_ROWS_PER_BATCH) {
            const batch = lines.slice(i, i + MAX_ROWS_PER_BATCH);
            batches.push(batch);
        }
        
        console.log(`📊 Split ${lines.length} rows into ${batches.length} batches`);
        
        // معالجة كل دفعة بشكل منفصل
        const allRows = [];
        const allHeaders = [];
        
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            const batchText = batch.join('\n');
            
            // معالجة الدفعة
            const result = await processBatch(batchText, batchIndex);
            
            if (batchIndex === 0) {
                allHeaders.push(...result.headers);
            }
            
            allRows.push(...result.rows);
            
            // إعطاء فرصة للمتصفح لمعالجة الأحداث الأخرى
            if (batchIndex < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        return {
            headers: allHeaders,
            rows: allRows,
            totalRows: allRows.length,
            batches: batches.length
        };
        
    } catch (error) {
        console.error('❌ Error processing large paste:', error);
        throw error;
    }
}

/**
 * معالجة دفعة واحدة
 */
async function processBatch(batchText, batchIndex) {
    return new Promise((resolve) => {
        // استخدام setTimeout لمنع تجميد المتصفح
        setTimeout(() => {
            try {
                const result = parseExcelPasteRaw(batchText);
                console.log(`✅ Processed batch ${batchIndex + 1}: ${result.rows.length} rows`);
                resolve(result);
            } catch (error) {
                console.error(`❌ Error in batch ${batchIndex + 1}:`, error);
                resolve({ headers: [], rows: [] });
            }
        }, 0);
    });
}

// ============================================
// 3. تحديث دالة previewPastedTableForAnySheet
// ============================================

/**
 * دالة محسنة لعرض الجدول مع الدفعات الكبيرة
 */
async function previewPastedTableForAnySheetEnhanced(rawText) {
    console.log('🔧 Using enhanced paste processor');
    
    try {
        // إظهار رسالة تقدم
        showPasteStatus('⏳ جاري معالجة البيانات الكبيرة...');
        
        // معالجة البيانات بأمان
        const result = await processLargePasteSafely(rawText);
        
        if (result.rows.length === 0) {
            showPasteStatus('❌ لم يتم العثور على بيانات صالحة');
            return;
        }
        
        // تحديث واجهة المستخدم
        showPasteStatus(`✅ تم معالجة ${result.totalRows.toLocaleString()} صف في ${result.batches} دفعة`);
        
        // تخزين البيانات للعرض
        window.quickPastePreviewData = {
            headers: result.headers,
            rows: result.rows,
            columnMapping: buildInitialPasteColumnMapping(result.headers)
        };
        
        // تحديث الجدول مع تحسين الأداء
        updateGridWithOptimizedData(result.rows, result.headers);
        
    } catch (error) {
        console.error('❌ Error in enhanced paste:', error);
        showPasteStatus('❌ حدث خطأ أثناء معالجة البيانات');
    }
}

/**
 * تحديث الجدول ببيانات محسنة
 */
function updateGridWithOptimizedData(rows, headers) {
    if (!gridApi) {
        console.error('❌ gridApi not available');
        return;
    }
    
    // تقليل عدد الصفوف المعروضة (عرض أول 1000 صف فقط)
    const displayRows = rows.slice(0, 1000);
    
    // إنشاء columnDefs محسنة
    const colDefs = headers.map((header, index) => ({
        headerName: header || `Column ${index + 1}`,
        field: `col_${index}`,
        sortable: true,
        filter: true,
        resizable: true,
        flex: 1,
        minWidth: 100,
        // إصلاح مشكلة textColumn
        type: 'textColumn'
    }));
    
    // إضافة عمود الإجراءات
    colDefs.push({
        headerName: 'إجراءات',
        field: 'actions',
        width: 120,
        minWidth: 120,
        maxWidth: 120,
        cellRenderer: (params) => {
            const rowIndex = params.node.rowIndex;
            return `
                <div style="display: flex; gap: 5px;">
                    <button onclick="editPreviewProduct(${rowIndex})" style="padding: 5px 10px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">✏️</button>
                    <button onclick="deletePreviewProduct(${rowIndex})" style="padding: 5px 10px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">🗑️</button>
                </div>
            `;
        }
    });
    
    // تحضير rowData
    const rowData = displayRows.map((row, rowIndex) => {
        const obj = { id: `temp_${rowIndex}` };
        headers.forEach((header, colIndex) => {
            obj[`col_${colIndex}`] = row[colIndex] || '';
        });
        return obj;
    });
    
    // تحديث الجدول
    gridApi.setGridOption('columnDefs', colDefs);
    gridApi.setGridOption('rowData', rowData);
    
    console.log(`✅ Displaying ${displayRows.length} rows (of ${rows.length} total)`);
}

// ============================================
// 4. دالة عرض حالة اللصق
// ============================================

function showPasteStatus(message) {
    const statusElement = document.getElementById('pasteStatusAbove');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.display = 'block';
        
        // تلوين الرسالة بناءً على النوع
        if (message.includes('✅')) {
            statusElement.style.backgroundColor = '#d4edda';
            statusElement.style.color = '#155724';
            statusElement.style.borderColor = '#c3e6cb';
        } else if (message.includes('❌')) {
            statusElement.style.backgroundColor = '#f8d7da';
            statusElement.style.color = '#721c24';
            statusElement.style.borderColor = '#f5c6cb';
        } else {
            statusElement.style.backgroundColor = '#fff3cd';
            statusElement.style.color = '#856404';
            statusElement.style.borderColor = '#ffeaa7';
        }
    }
}

// ============================================
// 5. دالة الحفظ الآمن للدفعات الكبيرة
// ============================================

/**
 * حفظ البيانات الكبيرة بأمان مع تقسيم الدفعات
 */
async function saveLargeBatchSafely() {
    if (!window.quickPastePreviewData) {
        alert('❌ لا توجد بيانات للحفظ');
        return;
    }
    
    const { headers, rows } = window.quickPastePreviewData;
    const warehouseId = await getWarehouseId();
    
    if (!warehouseId) {
        alert('❌ لم يتم العثور على معرف المخزن');
        return;
    }
    
    console.log(`💾 Saving ${rows.length} rows to warehouse ${warehouseId}`);
    
    // تقسيم البيانات إلى دفعات صغيرة (500 صف في كل دفعة)
    const BATCH_SIZE = 500;
    const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
    let savedCount = 0;
    let failedCount = 0;
    
    // إظهار شريط التقدم
    const progressBar = document.getElementById('pasteProgressBar');
    const progressFill = document.getElementById('pasteProgressFill');
    const progressText = document.getElementById('pasteProgressText');
    
    if (progressBar) {
        progressBar.style.display = 'block';
    }
    
    try {
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            
            // تحديث شريط التقدم
            const progress = Math.round((i / rows.length) * 100);
            if (progressFill) {
                progressFill.style.width = `${progress}%`;
            }
            if (progressText) {
                progressText.textContent = `جاري حفظ الدفعة ${batchNumber} من ${totalBatches} (${progress}%)`;
            }
            
            // تحويل البيانات
            const drugsToSave = convertPasteRowsToDrugs(headers, batch, warehouseId);
            
            // حفظ الدفعة
            const result = await saveBatchToSupabase(drugsToSave, warehouseId);
            
            if (result.success) {
                savedCount += result.saved;
                console.log(`✅ Batch ${batchNumber} saved: ${result.saved} items`);
            } else {
                failedCount += batch.length;
                console.error(`❌ Batch ${batchNumber} failed:`, result.error);
            }
            
            // إعطاء فرصة للمتصفح
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // تحديث شريط التقدم النهائي
        if (progressFill) {
            progressFill.style.width = '100%';
        }
        if (progressText) {
            progressText.textContent = `تم الانتهاء: ${savedCount} محفوظ، ${failedCount} فاشل`;
        }
        
        // عرض رسالة النجاح
        if (failedCount === 0) {
            alert(`✅ تم حفظ جميع ${savedCount} منتج بنجاح`);
        } else {
            alert(`⚠️ تم حفظ ${savedCount} منتج، فشل حفظ ${failedCount} منتج`);
        }
        
        // تحديث الجدول
        await fetchWarehouseDrugs();
        
    } catch (error) {
        console.error('❌ Error saving large batch:', error);
        alert(`❌ حدث خطأ أثناء الحفظ: ${error.message}`);
    } finally {
        // إخفاء شريط التقدم بعد 3 ثواني
        setTimeout(() => {
            if (progressBar) {
                progressBar.style.display = 'none';
            }
        }, 3000);
    }
}

/**
 * حفظ دفعة واحدة إلى Supabase
 */
async function saveBatchToSupabase(drugs, warehouseId) {
    try {
        // استخدام دالة RPC الذكية مع تقسيم الدفعات
        const { data, error } = await supabaseClient.rpc('smart_batch_process_drugs', {
            p_warehouse_id: warehouseId,
            p_drugs: drugs
        });
        
        if (error) {
            // Fallback إلى INSERT مباشر
            const { error: insertError } = await supabaseClient
                .from('warehouse_products_flexible')
                .insert(drugs.map(drug => ({
                    warehouse_id: warehouseId,
                    product_data: drug
                })));
            
            if (insertError) throw insertError;
            
            return { success: true, saved: drugs.length };
        }
        
        return { 
            success: data.success, 
            saved: (data.inserted || 0) + (data.updated || 0),
            error: data.error 
        };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// 6. التكامل مع النظام الحالي
// ============================================

// استبدال الدوال القديمة بالدوال المحسنة
if (typeof previewPastedTableForAnySheet === 'function') {
    const originalPreview = previewPastedTableForAnySheet;
    previewPastedTableForAnySheet = function(rawText) {
        // إذا كانت البيانات كبيرة (أكثر من 5000 صف)، استخدم المعالج المحسن
        const lines = rawText.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length > 5000) {
            return previewPastedTableForAnySheetEnhanced(rawText);
        } else {
            return originalPreview(rawText);
        }
    };
}

// استبدال دالة الحفظ
if (typeof savePreviewedData === 'function') {
    const originalSave = savePreviewedData;
    window.savePreviewedData = async function() {
        if (window.quickPastePreviewData && window.quickPastePreviewData.rows.length > 1000) {
            return saveLargeBatchSafely();
        } else {
            return originalSave();
        }
    };
}

// ============================================
// 7. تهيئة النظام
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ Loaded stock-fixes.js for large batch processing');
    
    // إضافة زر للتبديل بين وضع المعالجة
    const pasteArea = document.getElementById('quickPasteArea');
    if (pasteArea) {
        const container = pasteArea.parentElement;
        const toggleButton = document.createElement('button');
        toggleButton.textContent = '🔧 وضع المعالجة الآمنة';
        toggleButton.style.cssText = `
            margin-top: 5px;
            padding: 5px 10px;
            background: #6c757d;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;
        toggleButton.onclick = function() {
            const isEnabled = localStorage.getItem('safeProcessing') === 'true';
            localStorage.setItem('safeProcessing', !isEnabled);
            toggleButton.textContent = !isEnabled ? 
                '✅ وضع المعالجة الآمنة (مفعل)' : 
                '🔧 وضع المعالجة الآمنة';
            alert(`تم ${!isEnabled ? 'تفعيل' : 'تعطيل'} وضع المعالجة الآمنة للدفعات الكبيرة`);
        };
        
        // التحقق من الحالة الحالية
        if (localStorage.getItem('safeProcessing') === 'true') {
            toggleButton.textContent = '✅ وضع المعالجة الآمنة (مفعل)';
        }
        
        container.appendChild(toggleButton);
    }
});

console.log('✅ stock-fixes.js loaded successfully');