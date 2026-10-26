// ============================================
// تكامل جدول الصيدليات مع Supabase - بدون LocalStorage
// ============================================

class PharmaciesManager {
    constructor(supabaseClient) {
        this.supabase = supabaseClient;
        this.pharmacies = [];
        this.realtimeSubscription = null;
    }

    // ✅ الحصول على المستخدم من Supabase Auth (بدون LocalStorage)
    async getCurrentUser() {
        const { data: { user } } = await this.supabase.auth.getUser();
        return user;
    }

    // ✅ الحصول على UUID الخاص بالمستخدم من Supabase Auth
    async getCurrentUserId() {
        const user = await this.getCurrentUser();
        return user?.id || null;
    }

    // ========== CRUD Operations ==========

    // ✅ إضافة صيدلية جديدة - السيرفر يضع user_id تلقائياً
    async addPharmacy(pharmacyData) {
        try {
            // التحقق من البيانات
            if (!pharmacyData.name || !pharmacyData.phone) {
                throw new Error('اسم الصيدلية ورقم التليفون مطلوبان');
            }

            // التحقق من رقم التليفون (11 رقم)
            if (!this.validatePhone(pharmacyData.phone)) {
                throw new Error('رقم التليفون يجب أن يكون 11 رقم ويبدأ بـ 01');
            }

            // ✅ التحقق من تسجيل الدخول
            const userId = await this.getCurrentUserId();
            if (!userId) {
                throw new Error('يجب تسجيل الدخول أولاً');
            }

            // 🚫 حذف أي user_id/warehouse_id قد يكون في البيانات المدخلة
            // السيرفر سيضع user_id تلقائياً عبر DEFAULT auth.uid()
            const { user_id: _, warehouse_id: __, ...cleanData } = pharmacyData;

            // ✅ لا نرسل user_id - السيرفر يضعه تلقائياً
            const dataToInsert = {
                ...cleanData,
                created_at: new Date().toISOString()
            };

            console.log('📝 Inserting pharmacy (server will set user_id)');

            const { data, error } = await this.supabase
                .from('pharmacies')
                .insert([dataToInsert])
                .select()
                .single();

            if (error) throw error;

            // ✅ تحديث القائمة فوراً (Realtime سيتعامل مع الباقي)
            this.pharmacies.unshift(data);
            this.renderPharmaciesList();
            
            // إظهار رسالة نجاح
            this.showNotification('✅ تم حفظ الصيدلية بنجاح!', 'success');
            
            return { success: true, data };

        } catch (error) {
            console.error('Error adding pharmacy:', error);
            this.showNotification(`❌ خطأ: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    // تحديث صيدلية
    async updatePharmacy(pharmacyId, updates) {
        try {
            // التحقق من رقم التليفون إذا تم تغييره
            if (updates.phone && !this.validatePhone(updates.phone)) {
                throw new Error('رقم التليفون يجب أن يكون 11 رقم ويبدأ بـ 01');
            }

            // ✅ الحصول على user_id من Supabase Auth للتحديث
            const userId = await this.getCurrentUserId();
            if (!userId) {
                throw new Error('يجب تسجيل الدخول أولاً');
            }

            // ✅ التحديث فقط إذا كان user_id مطابق (RLS سيتحقق أيضاً)
            const { data, error } = await this.supabase
                .from('pharmacies')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', pharmacyId)
                .eq('user_id', userId)  // ← فلتر الملكية من Supabase Auth
                .select()
                .single();

            if (error) throw error;

            this.showNotification('✅ تم تحديث الصيدلية بنجاح!', 'success');
            await this.loadPharmacies();
            
            return { success: true, data };

        } catch (error) {
            console.error('Error updating pharmacy:', error);
            this.showNotification(`❌ خطأ: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    // حذف صيدلية (فقط للمستخدم الحالي - مع فلتر user_id من Supabase Auth)
    async deletePharmacy(pharmacyId) {
        try {
            if (!confirm('هل أنت متأكد من حذف هذه الصيدلية؟')) {
                return { success: false, cancelled: true };
            }

            // ✅ الحصول على user_id من Supabase Auth (بدون LocalStorage)
            const userId = await this.getCurrentUserId();
            if (!userId) {
                throw new Error('يجب تسجيل الدخول أولاً');
            }

            // ✅ فلتر user_id للأمان - الحذف فقط للمالك (من Supabase Auth)
            const { data, error } = await this.supabase
                .from('pharmacies')
                .delete()
                .eq('id', pharmacyId)
                .eq('user_id', userId)  // ← فلتر الملكية من Supabase Auth
                .select();

            if (error) throw error;
            
            // ✅ التحقق من أنه تم الحذف فعلاً
            if (!data || data.length === 0) {
                console.warn('⚠️ Pharmacy not found or not owned by current user');
                this.showNotification('❌ لا يمكن الحذف: الصيدلية ليست تابعة لك', 'error');
                return { success: false, error: 'Not authorized or not found' };
            }

            this.showNotification('✅ تم حذف الصيدلية بنجاح!', 'success');
            
            // ✅ تحديث UI فوراً بدون إعادة تحميل الصفحة
            this.pharmacies = this.pharmacies.filter(p => p.id !== pharmacyId);
            this.renderPharmaciesList();
            console.log('🗑️ UI updated - pharmacy removed from list');
            
            return { success: true };

        } catch (error) {
            console.error('Error deleting pharmacy:', error);
            this.showNotification(`❌ خطأ: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    // جلب جميع الصيدليات (RLS يتكفل بالفلترة - بدون LocalStorage)
    async loadPharmacies() {
        try {
            // ✅ فقط select('*') - الـ RLS في السيرفر يتكفل بعرض صيدليات هذا المخزن فقط
            const { data, error } = await this.supabase
                .from('pharmacies')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;

            this.pharmacies = data || [];
            this.renderPharmaciesList();
            
            return { success: true, data: this.pharmacies };

        } catch (error) {
            console.error('Error loading pharmacies:', error);
            this.showNotification(`❌ خطأ في تحميل البيانات: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    // البحث في الصيدليات (RLS يتكفل بالفلترة)
    async searchPharmacies(query) {
        try {
            // ✅ البحث فقط - RLS يضمن عرض صيدليات المستخدم فقط
            const { data, error } = await this.supabase
                .from('pharmacies')
                .select('*')
                .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
                .order('name', { ascending: true });

            if (error) throw error;

            return { success: true, data: data || [] };

        } catch (error) {
            console.error('Error searching pharmacies:', error);
            return { success: false, error: error.message };
        }
    }

    // ========== Real-time ==========

    // ✅ الاشتراك في التحديثات الفورية باستخدام supabase.channel
    subscribeToRealtime() {
        try {
            // إلغاء الاشتراك السابق إذا وجد
            if (this.realtimeSubscription) {
                this.realtimeSubscription.unsubscribe();
            }

            // ✅ إنشاء channel باستخدام supabase.channel()
            this.realtimeSubscription = this.supabase
                .channel('pharmacies_changes')
                .on('postgres_changes', 
                    { 
                        event: 'INSERT',           // ← مراقبة عمليات INSERT فقط
                        schema: 'public', 
                        table: 'pharmacies'
                        // ✅ RLS يتكفل بالفلترة حسب user_id
                    },
                    async (payload) => {
                        console.log('🔄 Real-time INSERT:', payload);
                        await this.handleInsertRealtime(payload);
                    }
                )
                .on('postgres_changes',
                    {
                        event: 'UPDATE',           // ← مراقبة عمليات UPDATE
                        schema: 'public',
                        table: 'pharmacies'
                    },
                    async (payload) => {
                        console.log('🔄 Real-time UPDATE:', payload);
                        await this.handleUpdateRealtime(payload);
                    }
                )
                .on('postgres_changes',
                    {
                        event: 'DELETE',           // ← مراقبة عمليات DELETE
                        schema: 'public',
                        table: 'pharmacies'
                    },
                    async (payload) => {
                        console.log('🔄 Real-time DELETE:', payload);
                        await this.handleDeleteRealtime(payload);
                    }
                )
                .subscribe((status) => {
                    console.log('📡 Real-time status:', status);
                });

            console.log('✅ Real-time subscription activated');
            return true;

        } catch (error) {
            console.error('❌ Error subscribing to real-time:', error);
            return false;
        }
    }

    // ✅ معالجة إضافة جديدة - تحديث تلقائي للقائمة
    async handleInsertRealtime(payload) {
        const { new: newRecord } = payload;
        
        // ✅ التحقق من user_id (أمان إضافي)
        const currentUserId = await this.getCurrentUserId();
        if (newRecord.user_id !== currentUserId) {
            console.log('🚫 Ignoring INSERT for different user');
            return;
        }
        
        // ✅ إضافة للمصفوفة وتحديث العرض
        this.pharmacies.unshift(newRecord);
        this.renderPharmaciesList();  // ← تحديث فوري للقائمة
        this.showNotification(`✅ تم إضافة صيدلية جديدة: ${newRecord.name}`, 'success');
    }

    // ✅ معالجة تحديث - تحديث تلقائي
    async handleUpdateRealtime(payload) {
        const { new: newRecord } = payload;
        
        // ✅ التحقق من user_id
        const currentUserId = await this.getCurrentUserId();
        if (newRecord.user_id !== currentUserId) {
            console.log('🚫 Ignoring UPDATE for different user');
            return;
        }
        
        // ✅ تحديث في المصفوفة وإعادة العرض
        const index = this.pharmacies.findIndex(p => p.id === newRecord.id);
        if (index !== -1) {
            this.pharmacies[index] = newRecord;
            this.renderPharmaciesList();  // ← تحديث فوري
            this.showNotification(`📝 تم تحديث صيدلية: ${newRecord.name}`, 'info');
        }
    }

    // ✅ معالجة حذف - تحديث تلقائي
    async handleDeleteRealtime(payload) {
        const { old: oldRecord } = payload;
        
        // ✅ إزالة من المصفوفة وإعادة العرض
        this.pharmacies = this.pharmacies.filter(p => p.id !== oldRecord.id);
        this.renderPharmaciesList();  // ← تحديث فوري
        this.showNotification(`🗑️ تم حذف صيدلية: ${oldRecord.name}`, 'info');
    }

    // الاحتفاظ بالدالة القديمة للتوافق
    handleRealtimeUpdate(payload) {
        const { eventType } = payload;
        switch (eventType) {
            case 'INSERT': this.handleInsertRealtime(payload); break;
            case 'UPDATE': this.handleUpdateRealtime(payload); break;
            case 'DELETE': this.handleDeleteRealtime(payload); break;
        }

        this.renderPharmaciesList();
    }

    // إلغاء الاشتراك
    unsubscribe() {
        if (this.realtimeSubscription) {
            this.realtimeSubscription.unsubscribe();
            this.realtimeSubscription = null;
            console.log('❌ Real-time subscription cancelled');
        }
    }

    // ========== Validation ==========

    // التحقق من رقم التليفون
    validatePhone(phone) {
        // يجب أن يكون 11 رقم ويبدأ بـ 01
        const phoneRegex = /^01[0-9]{9}$/;
        return phoneRegex.test(phone);
    }

    // ========== UI Helpers ==========

    // عرض القائمة
    renderPharmaciesList() {
        const container = document.getElementById('pharmaciesList');
        if (!container) return;

        if (this.pharmacies.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🏥</div>
                    <div class="empty-text">لا توجد صيدليات مسجلة</div>
                    <p>أضف صيدلية جديدة للبدء</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.pharmacies.map(pharmacy => `
            <div class="pharmacy-card" data-id="${pharmacy.id}">
                <div class="pharmacy-info">
                    <h4>${pharmacy.name}</h4>
                    <p>📞 ${pharmacy.phone}</p>
                    ${pharmacy.address ? `<p>📍 ${pharmacy.address}</p>` : ''}
                    ${pharmacy.email ? `<p>✉️ ${pharmacy.email}</p>` : ''}
                </div>
                <div class="pharmacy-actions">
                    <button onclick="pharmaciesManager.editPharmacy('${pharmacy.id}')" class="btn-edit">
                        ✏️ تعديل
                    </button>
                    <button onclick="pharmaciesManager.deletePharmacy('${pharmacy.id}')" class="btn-delete">
                        🗑️ حذف
                    </button>
                </div>
            </div>
        `).join('');
    }

    // عرض نموذج الإضافة/التعديل
    showPharmacyForm(pharmacyId = null) {
        const pharmacy = pharmacyId ? this.pharmacies.find(p => p.id === pharmacyId) : null;
        const isEdit = !!pharmacy;

        const modalHtml = `
            <div id="pharmacyModal" class="modal">
                <div class="modal-content">
                    <h3>${isEdit ? 'تعديل صيدلية' : 'إضافة صيدلية جديدة'}</h3>
                    <form id="pharmacyForm">
                        <input type="hidden" id="pharmacyId" value="${pharmacy?.id || ''}">
                        
                        <div class="form-group">
                            <label>اسم الصيدلية *</label>
                            <input type="text" id="pharmacyName" 
                                   value="${pharmacy?.name || ''}" 
                                   placeholder="مثال: صيدلية الأمل" required>
                        </div>
                        
                        <div class="form-group">
                            <label>رقم التليفون * (11 رقم)</label>
                            <input type="tel" id="pharmacyPhone" 
                                   value="${pharmacy?.phone || ''}" 
                                   placeholder="01xxxxxxxxx" 
                                   maxlength="11" required>
                            <small>يجب أن يبدأ بـ 01 ويتكون من 11 رقم</small>
                        </div>
                        
                        <div class="form-group">
                            <label>العنوان</label>
                            <input type="text" id="pharmacyAddress" 
                                   value="${pharmacy?.address || ''}" 
                                   placeholder="عنوان الصيدلية">
                        </div>
                        
                        <div class="form-group">
                            <label>البريد الإلكتروني</label>
                            <input type="email" id="pharmacyEmail" 
                                   value="${pharmacy?.email || ''}" 
                                   placeholder="email@example.com">
                        </div>
                        
                        <div class="form-group">
                            <label>شخص التواصل</label>
                            <input type="text" id="pharmacyContact" 
                                   value="${pharmacy?.contact_person || ''}" 
                                   placeholder="اسم شخص التواصل">
                        </div>
                        
                        <div class="form-actions">
                            <button type="submit" class="btn-save">
                                ${isEdit ? '💾 حفظ التغييرات' : '➕ إضافة صيدلية'}
                            </button>
                            <button type="button" onclick="pharmaciesManager.closeModal()" class="btn-cancel">
                                ❌ إلغاء
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // ربط حدث الحفظ
        document.getElementById('pharmacyForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.savePharmacy();
        });

        // التحقق المباشر من رقم التليفون
        document.getElementById('pharmacyPhone').addEventListener('input', (e) => {
            const phone = e.target.value;
            const isValid = this.validatePhone(phone);
            e.target.style.borderColor = isValid ? 'green' : phone.length === 11 ? 'red' : '';
        });
    }

    // حفظ الصيدلية من النموذج
    async savePharmacy() {
        const pharmacyId = document.getElementById('pharmacyId').value;
        
        const pharmacyData = {
            name: document.getElementById('pharmacyName').value.trim(),
            phone: document.getElementById('pharmacyPhone').value.trim(),
            address: document.getElementById('pharmacyAddress').value.trim(),
            email: document.getElementById('pharmacyEmail').value.trim() || null,
            contact_person: document.getElementById('pharmacyContact').value.trim() || null
        };

        if (pharmacyId) {
            await this.updatePharmacy(pharmacyId, pharmacyData);
        } else {
            await this.addPharmacy(pharmacyData);
        }

        this.closeModal();
    }

    // إغلاق النافذة المنبثقة
    closeModal() {
        const modal = document.getElementById('pharmacyModal');
        if (modal) modal.remove();
    }

    // تعديل صيدلية (فتح النموذج)
    editPharmacy(pharmacyId) {
        this.showPharmacyForm(pharmacyId);
    }

    // عرض إشعار
    showNotification(message, type = 'info') {
        // إذا كانت هناك دالة AIUI متاحة
        if (window.AIUI && window.AIUI.showNotification) {
            window.AIUI.showNotification(message, type);
        } else {
            // إشعار بسيط
            const notification = document.createElement('div');
            notification.className = `notification notification-${type}`;
            notification.textContent = message;
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                padding: 15px 25px;
                border-radius: 8px;
                color: white;
                font-weight: bold;
                z-index: 9999;
                animation: slideDown 0.3s ease;
                background: ${type === 'success' ? '#38ef7d' : type === 'error' ? '#ff4757' : '#3498db'};
            `;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
        }
    }
}

// ============================================
// CSS Styles (إضفها في ملف CSS أو في head)
// ============================================
const pharmaciesStyles = `
<style>
.pharmacy-card {
    background: var(--card-bg);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 15px;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: transform 0.2s;
}
.pharmacy-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
}
.pharmacy-info h4 {
    margin: 0 0 5px 0;
    color: var(--primary);
}
.pharmacy-info p {
    margin: 3px 0;
    font-size: 14px;
    color: var(--text-muted);
}
.pharmacy-actions {
    display: flex;
    gap: 10px;
}
.btn-edit, .btn-delete {
    padding: 8px 15px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
}
.btn-edit {
    background: #3498db;
    color: white;
}
.btn-delete {
    background: #e74c3c;
    color: white;
}
.btn-save {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 12px 30px;
    border: none;
    border-radius: 25px;
    cursor: pointer;
    font-weight: bold;
}
.btn-cancel {
    background: transparent;
    border: 1px solid var(--text-muted);
    color: var(--text-muted);
    padding: 12px 30px;
    border-radius: 25px;
    cursor: pointer;
}
.modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}
.modal-content {
    background: var(--card-bg);
    padding: 30px;
    border-radius: 20px;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
}
.form-group {
    margin-bottom: 20px;
}
.form-group label {
    display: block;
    margin-bottom: 8px;
    font-weight: 600;
}
.form-group input {
    width: 100%;
    padding: 12px;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    font-family: inherit;
}
.form-group small {
    color: var(--text-muted);
    font-size: 12px;
}
.form-actions {
    display: flex;
    gap: 15px;
    justify-content: center;
    margin-top: 25px;
}
.empty-state {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
}
.empty-icon {
    font-size: 48px;
    margin-bottom: 15px;
}
@keyframes slideDown {
    from { transform: translate(-50%, -100%); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
}
</style>
`;

// إضافة الـ CSS للصفحة
document.head.insertAdjacentHTML('beforeend', pharmaciesStyles);

// ============================================
// Usage Example
// ============================================
// const pharmaciesManager = new PharmaciesManager(supabaseClient);
// pharmaciesManager.loadPharmacies();
// pharmaciesManager.subscribeToRealtime();
