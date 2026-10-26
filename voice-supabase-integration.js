// سلامتك - Voice Input Integration with Supabase
// دمج الإدخال الصوتي مع قاعدة البيانات

// دالة لمعالجة الإدخال الصوتي وإرساله إلى Supabase
async function processVoiceInputAndSubmit(transcript) {
    console.log('🎤 معالجة الإدخال الصوتي:', transcript);

    try {
        // تحويل النص الصوتي إلى بيانات منظمة
        const voiceProcessor = new VoiceInputProcessor();
        const conversion = voiceProcessor.arabicNumberConverter.extractNumbersAndWords(transcript);
        const processed = voiceProcessor.analyzeInput(conversion);

        console.log('🎯 البيانات بعد التحليل:', processed);

        // ملء الحقول بالبيانات المستخرجة
        voiceProcessor.fillFields(processed);

        // عرض النتيجة للمستخدم
        voiceProcessor.showResult(processed);

        // التحقق من اكتمال جميع الحقول الأساسية
        const productName = document.getElementById('productName').value.trim();
        const priceInt = document.getElementById('priceInt').value.trim();
        const priceFrac = document.getElementById('priceFrac').value.trim();
        const quantity = document.getElementById('quantity').value.trim();

        if (productName && priceInt && priceFrac && quantity) {
            console.log('✅ جميع الحقول الأساسية ممتلئة');

            // تجميع السعر
            const price = parseFloat(`${priceInt}.${priceFrac.padStart(2, '0')}`);

            // إنشاء كائن البيانات
            const productData = {
                productName: productName,
                price: price,
                discount: parseFloat(document.getElementById('discount').value) || 0,
                quantity: parseInt(quantity),
                productionDate: getSplitDate('prod'),
                expiryDate: getSplitDate('exp'),
                warehouse_id: localStorage.getItem('currentWarehouseId') || 'local_user',
                addedDate: new Date().toISOString()
            };

            // إرسال البيانات إلى Supabase
            await saveToSupabase(productData);

            // عرض رسالة نجاح
            showCustomAlert('تم إضافة المنتج بنجاح!', 'success');

            // إعادة تعيين النموذج
            document.getElementById('productForm').reset();
            checkFormValidity();
        } else {
            console.log('⚠️ بعض الحقول الأساسية فارغة');
            showCustomAlert('يرجى ملء جميع الحقول الأساسية', 'error');
        }
    } catch (error) {
        console.error('❌ خطأ في معالجة الإدخال الصوتي:', error);
        showCustomAlert('حدث خطأ أثناء معالجة الإدخال الصوتي', 'error');
    }
}

// دالة مساعدة للحصول على التاريخ المقسم
function getSplitDate(prefix) {
    const day = document.getElementById(prefix + 'Day').value || '01';
    const month = document.getElementById(prefix + 'Month').value || '01';
    const year = document.getElementById(prefix + 'Year').value || '2024';
    return `${year}-${month}-${day}`;
}

// دالة لحفظ البيانات في Supabase
async function saveToSupabase(productData) {
    try {
        // التحقق من وجود supabaseInstance
        if (typeof window.supabaseInstance === 'undefined') {
            console.warn('Supabase instance not found');
            showCustomAlert('فشل حفظ البيانات في السيرفر - مكتبة Supabase غير متاحة', 'error');
            return;
        }

        // حفظ البيانات في Supabase
        const { data, error } = await window.supabaseInstance
            .from('products')
            .insert([productData])
            .select();

        if (error) {
            console.error('خطأ في حفظ البيانات:', error);
            showCustomAlert('فشل حفظ البيانات في السيرفر', 'error');
        } else {
            console.log('تم الحفظ بنجاح في Supabase:', data);

            // حفظ في localStorage كنسخة احتياطية
            const products = JSON.parse(localStorage.getItem('products')) || [];
            productData.id = Date.now();
            products.push(productData);
            localStorage.setItem('products', JSON.stringify(products));
        }
    } catch (error) {
        console.error('خطأ في الاتصال بـ Supabase:', error);
        showCustomAlert('فشل حفظ البيانات في السيرفر', 'error');
    }
}

// دالة لعرض رسالة مخصصة
function showCustomAlert(message, type) {
    const container = document.getElementById('alertContainer');
    const alertClass = type === 'success' ? 'alert-success' : 'alert-error';
    container.innerHTML = `
        <div class="alert ${alertClass}" style="display:block; padding:15px; margin-top:15px; border-radius:8px; text-align:center; font-weight:600; color: ${type === 'success' ? '#155724' : '#721c24'}; background: ${type === 'success' ? '#d4edda' : '#f8d7da'};">
            ${message}
        </div>
    `;
    setTimeout(() => { container.innerHTML = ''; }, 4000);
}
