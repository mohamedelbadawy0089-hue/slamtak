// دالة إرسال الأوردر لموظف التحضير ورجل الدليفري معاً
function sendToPreparationAndDelivery() {
    var preparationPhone = currentUser.preparationPhone;
    
    // إذا لم يكن هناك رقم محفوظ، اطلبه من المستخدم
    if (!preparationPhone) {
        preparationPhone = prompt('أدخل رقم واتساب موظف التحضير (مع كود الدولة):\nمثال: 201234567890\n\nسيتم حفظ الرقم للأوردرات القادمة');
        
        if (!preparationPhone) {
            if (confirm('لم يتم إدخال رقم موظف التحضير.\n\nهل تريد إرسال الأوردر لرجل الدليفري فقط؟')) {
                loadDeliveryPersons();
            } else {
                sessionStorage.removeItem('selectedPharmacy');
                window.location.replace('pharmacies.html');
            }
            return;
        }
        
        preparationPhone = preparationPhone.trim();
        if (preparationPhone.length < 10) {
            alert('رقم الهاتف غير صحيح. يجب أن يكون 10 أرقام على الأقل.');
            sendToPreparationAndDelivery();
            return;
        }
        
        savePreparationPhoneToStorage(preparationPhone);
    }
    
    // بناء رسالة موظف التحضير
    var prepMessage = '🔔 *طلب تحضير أوردر جديد*%0A%0A';
    prepMessage += '📋 رقم الأوردر: *#' + lastCreatedOrder.orderNumber + '*%0A';
    prepMessage += '📅 التاريخ: ' + new Date().toLocaleDateString('ar-EG') + '%0A';
    prepMessage += '🏢 المخزن: ' + lastCreatedOrder.warehouseName + '%0A%0A';
    prepMessage += '🏥 *بيانات الصيدلية:*%0A';
    prepMessage += '📌 الاسم: ' + lastCreatedOrder.pharmacyName + '%0A';
    prepMessage += '📞 التليفون: ' + lastCreatedOrder.pharmacyPhone + '%0A';
    prepMessage += '📍 العنوان: ' + lastCreatedOrder.pharmacyAddress + '%0A%0A';
    prepMessage += '📦 *المنتجات المطلوب تحضيرها:*%0A━━━━━━━━━━━━━━━━%0A';
    
    lastCreatedOrder.products.forEach(function(product, index) {
        var afterDiscount = product.price - (product.price * product.discount / 100);
        prepMessage += (index + 1) + '. *' + product.productName + '*%0A';
        prepMessage += '   • الكمية: *' + product.quantity + '*%0A';
        prepMessage += '   • السعر: ' + product.price.toFixed(2) + ' ج';
        if (product.discount > 0) {
            prepMessage += ' (خصم ' + product.discount + '%)%0A';
            prepMessage += '   • بعد الخصم: ' + afterDiscount.toFixed(2) + ' ج%0A';
        } else {
            prepMessage += '%0A';
        }
        if (product.expiryDate) prepMessage += '   • الصلاحية: ' + product.expiryDate + '%0A';
        prepMessage += '%0A';
    });
    
    prepMessage += '━━━━━━━━━━━━━━━━%0A📊 *الإجمالي:*%0A';
    prepMessage += '• عدد الأصناف: ' + lastCreatedOrder.products.length + '%0A';
    prepMessage += '• المبلغ الإجمالي: *' + lastCreatedOrder.totalAmount.toFixed(2) + ' جنيه*%0A%0A';
    prepMessage += '⏰ *يرجى تحضير الأوردر في أقرب وقت*';
    
    // فتح واتساب لموظف التحضير
    window.open('https://wa.me/' + preparationPhone + '?text=' + prepMessage, '_blank');
    
    // تحميل رجال الدليفري وحفظ رقم موظف التحضير
    window.tempPreparationPhone = preparationPhone;
    loadDeliveryPersonsForBoth();
}

function loadDeliveryPersonsForBoth() {
    var req = indexedDB.open('WarehouseDB', 5);
    req.onsuccess = function() {
        var db = req.result;
        if (!db.objectStoreNames.contains('delivery')) {
            loadDeliveryFromLocalStorageForBoth();
            return;
        }
        var tx = db.transaction(['delivery'], 'readonly');
        var r = tx.objectStore('delivery').index('userId').getAll(currentUser.email);
        r.onsuccess = function() {
            allDeliveryPersons = r.result || [];
            if (allDeliveryPersons.length === 0) {
                loadDeliveryFromLocalStorageForBoth();
            } else {
                displayDeliveryListForBoth();
            }
        };
        r.onerror = loadDeliveryFromLocalStorageForBoth;
    };
    req.onerror = loadDeliveryFromLocalStorageForBoth;
}

function loadDeliveryFromLocalStorageForBoth() {
    var delivery = JSON.parse(localStorage.getItem('delivery')) || [];
    allDeliveryPersons = delivery.filter(function(d) { 
        return d.userId === currentUser.email; 
    });
    displayDeliveryListForBoth();
}

function displayDeliveryListForBoth() {
    if (allDeliveryPersons.length === 0) {
        alert('لا يوجد رجال دليفري مسجلين.\n\nتم إرسال الأوردر لموظف التحضير فقط.');
        sessionStorage.removeItem('selectedPharmacy');
        window.location.replace('pharmacies.html');
        return;
    }

    var deliveryList = document.getElementById('deliveryList');
    deliveryList.innerHTML = '';

    allDeliveryPersons.forEach(function(person) {
        var div = document.createElement('div');
        div.className = 'delivery-item';
        div.onclick = function() { selectDelivery(person.phone, div); };
        div.innerHTML =
            '<div class="delivery-name">👤 ' + person.name + '</div>' +
            '<div class="delivery-phone">📞 ' + person.phone + '</div>';
        deliveryList.appendChild(div);
    });

    document.getElementById('deliveryModal').style.display = 'block';
}
