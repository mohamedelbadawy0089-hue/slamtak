// دالة مساعدة لإرسال إشعار للمخزن عند إنشاء أوردر جديد
function sendOrderNotification(warehouseUserId, orderData) {
    const notification = {
        userId: warehouseUserId,
        title: 'أوردر جديد من صيدلية',
        message: `تم استلام أوردر جديد من ${orderData.pharmacyName}`,
        pharmacyName: orderData.pharmacyName,
        pharmacyPhone: orderData.pharmacyPhone,
        pharmacyAddress: orderData.pharmacyAddress,
        pharmacyGPS: orderData.pharmacyGPS || null,
        orderNumber: orderData.orderNumber || orderData.id,
        orderDate: orderData.orderDate || new Date().toISOString().split('T')[0],
        products: orderData.products || [], // [{productName, quantity, price, discount}]
        itemsCount: orderData.itemsCount || (orderData.products ? orderData.products.length : 0),
        totalAmount: orderData.totalAmount || 0,
        isRead: false,
        createdAt: new Date().toISOString()
    };
    
    // محاولة حفظ في IndexedDB
    const request = indexedDB.open('WarehouseDB', 5);
    
    request.onsuccess = function() {
        const db = request.result;
        
        if (!db.objectStoreNames.contains('notifications')) {
            // استخدام localStorage كبديل
            saveToLocalStorage(notification);
            return;
        }
        
        const transaction = db.transaction(['notifications'], 'readwrite');
        const objectStore = transaction.objectStore('notifications');
        objectStore.add(notification);
        
        transaction.oncomplete = function() {
            console.log('تم إرسال الإشعار بنجاح');
            // حفظ الأوردر أيضاً في جدول الأوردرات
            saveOrderToDatabase(warehouseUserId, orderData);
        };
        
        transaction.onerror = function() {
            saveToLocalStorage(notification);
        };
    };
    
    request.onerror = function() {
        saveToLocalStorage(notification);
    };
}

function saveOrderToDatabase(warehouseUserId, orderData) {
    const order = {
        userId: warehouseUserId,
        pharmacyName: orderData.pharmacyName,
        pharmacyPhone: orderData.pharmacyPhone,
        pharmacyAddress: orderData.pharmacyAddress,
        pharmacyGPS: orderData.pharmacyGPS || null,
        orderNumber: orderData.orderNumber || Date.now(),
        orderDate: orderData.orderDate || new Date().toISOString().split('T')[0],
        products: orderData.products || [],
        itemsCount: orderData.itemsCount || (orderData.products ? orderData.products.length : 0),
        totalAmount: orderData.totalAmount || 0,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    
    const request = indexedDB.open('WarehouseDB', 5);
    
    request.onsuccess = function() {
        const db = request.result;
        
        if (!db.objectStoreNames.contains('orders')) {
            const ordersLS = JSON.parse(localStorage.getItem('orders')) || [];
            ordersLS.push(order);
            localStorage.setItem('orders', JSON.stringify(ordersLS));
            return;
        }
        
        const transaction = db.transaction(['orders'], 'readwrite');
        const objectStore = transaction.objectStore('orders');
        objectStore.add(order);
    };
    
    request.onerror = function() {
        const ordersLS = JSON.parse(localStorage.getItem('orders')) || [];
        ordersLS.push(order);
        localStorage.setItem('orders', JSON.stringify(ordersLS));
    };
}

function saveToLocalStorage(notification) {
    const notifications = JSON.parse(localStorage.getItem('notifications')) || [];
    notifications.push(notification);
    localStorage.setItem('notifications', JSON.stringify(notifications));
    console.log('تم حفظ الإشعار في localStorage');
    
    // حفظ الأوردر أيضاً
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    orders.push({
        userId: notification.userId,
        pharmacyName: notification.pharmacyName,
        pharmacyPhone: notification.pharmacyPhone,
        pharmacyAddress: notification.pharmacyAddress,
        pharmacyGPS: notification.pharmacyGPS,
        orderNumber: notification.orderNumber,
        orderDate: notification.orderDate,
        products: notification.products,
        itemsCount: notification.itemsCount,
        totalAmount: notification.totalAmount,
        status: 'pending',
        createdAt: notification.createdAt
    });
    localStorage.setItem('orders', JSON.stringify(orders));
}

// مثال على استخدام الدالة عند إنشاء أوردر:
/*
const orderData = {
    pharmacyName: 'صيدلية النهضة',
    pharmacyPhone: '01012345678',
    pharmacyAddress: 'شارع الجمهورية، القاهرة',
    pharmacyGPS: { lat: 30.0444, lng: 31.2357 },
    orderNumber: '12345',
    orderDate: '2024-01-15',
    products: [
        { productName: 'باراسيتامول 500', quantity: 10, price: 50, discount: 10 },
        { productName: 'أسبرين 100', quantity: 5, price: 25, discount: 5 }
    ],
    itemsCount: 2,
    totalAmount: 1500.50
};

sendOrderNotification('warehouse@example.com', orderData);
*/
