// Product List Auto-Update System
// تحديث تلقائي لقائمة المنتجات عند الإضافة

(function() {
    'use strict';

    console.log('🔄 تحميل نظام التحديث التلقائي للمنتجات...');

    // الاستماع للرسائل من نافذة إضافة المنتج
    window.addEventListener('message', function(event) {
        // التحقق من نوع الرسالة
        if (event.data && event.data.type === 'PRODUCT_ADDED') {
            console.log('✅ تم استقبال إشعار بإضافة منتج جديد:', event.data.product);
            
            // تحديث القائمة
            updateProductList(event.data.product);
            
            // عرض إشعار
            showNotification('تم إضافة منتج جديد: ' + event.data.product.name);
        }
    });

    // الاستماع للأحداث المخصصة
    window.addEventListener('productAdded', function(event) {
        console.log('✅ تم استقبال حدث إضافة منتج:', event.detail);
        updateProductList(event.detail);
    });

    // تحديث قائمة المنتجات
    function updateProductList(newProduct) {
        try {
            // تحديث localStorage
            const products = JSON.parse(localStorage.getItem('products')) || [];
            
            // التحقق من عدم التكرار
            const exists = products.some(p => p.id === newProduct.id);
            if (!exists) {
                products.unshift(newProduct); // إضافة في البداية
                localStorage.setItem('products', JSON.stringify(products));
                console.log('💾 تم تحديث localStorage');
            }

            // تحديث الجدول إذا كان موجوداً
            const tableBody = document.querySelector('#productsTable tbody');
            if (tableBody) {
                addProductToTable(tableBody, newProduct);
                console.log('📊 تم تحديث الجدول');
            }

            // تحديث العداد
            updateProductCount();

            // إعادة تحميل الصفحة إذا لزم الأمر
            if (typeof loadProducts === 'function') {
                loadProducts();
                console.log('🔄 تم إعادة تحميل قائمة المنتجات');
            }

        } catch (error) {
            console.error('❌ خطأ في تحديث القائمة:', error);
        }
    }

    // إضافة منتج للجدول
    function addProductToTable(tableBody, product) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${product.name || product.productName}</td>
            <td>${product.quantity}</td>
            <td>${product.price ? product.price.toFixed(2) : '0.00'} جنيه</td>
            <td>${product.discount || 0}%</td>
            <td>${formatDate(product.production_date || product.productionDate)}</td>
            <td>${formatDate(product.expiry_date || product.expiryDate)}</td>
            <td>
                <button class="btn-edit" onclick="editProduct(${product.id})">تعديل</button>
                <button class="btn-delete" onclick="deleteProduct(${product.id})">حذف</button>
            </td>
        `;
        
        // إضافة في البداية
        tableBody.insertBefore(row, tableBody.firstChild);
        
        // تأثير بصري
        row.style.backgroundColor = '#d4edda';
        setTimeout(() => {
            row.style.transition = 'background-color 1s';
            row.style.backgroundColor = '';
        }, 2000);
    }

    // تنسيق التاريخ
    function formatDate(dateString) {
        if (!dateString) return '-';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('ar-EG');
        } catch {
            return dateString;
        }
    }

    // تحديث عداد المنتجات
    function updateProductCount() {
        const countElement = document.querySelector('.product-count');
        if (countElement) {
            const products = JSON.parse(localStorage.getItem('products')) || [];
            countElement.textContent = products.length;
        }
    }

    // عرض إشعار
    function showNotification(message) {
        // إنشاء عنصر الإشعار
        const notification = document.createElement('div');
        notification.className = 'product-notification';
        notification.innerHTML = `
            <div style="
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 25px;
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 10000;
                animation: slideIn 0.5s ease-out;
                font-weight: 600;
            ">
                ✅ ${message}
            </div>
        `;

        // إضافة CSS للأنيميشن
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        // إزالة بعد 3 ثواني
        setTimeout(() => {
            notification.style.transition = 'opacity 0.5s';
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    // تحديث تلقائي من Supabase كل 30 ثانية
    async function autoRefreshFromSupabase() {
        try {
            let supabaseClient = null;
            
            if (window.SupabaseSingleton && typeof window.SupabaseSingleton.getClient === 'function') {
                supabaseClient = window.SupabaseSingleton.getClient();
            }
            
            if (!supabaseClient) return;

            const { data, error } = await supabaseClient
                .from('products')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);

            if (!error && data) {
                localStorage.setItem('products', JSON.stringify(data));
                console.log('🔄 تم تحديث المنتجات من Supabase:', data.length);
                
                // إعادة تحميل القائمة
                if (typeof loadProducts === 'function') {
                    loadProducts();
                }
            }
        } catch (error) {
            console.error('❌ خطأ في التحديث التلقائي:', error);
        }
    }

    // بدء التحديث التلقائي
    setInterval(autoRefreshFromSupabase, 30000); // كل 30 ثانية

    console.log('✅ نظام التحديث التلقائي جاهز');

})();
