// ============================================
// نظام العزل التام - Data Isolation Handler
// ============================================
// يتعامل مع أخطاء RLS ويظهر رسائل مناسبة للمستخدم
// ============================================

(function() {
    'use strict';

    // ============================================
    // 1. معالج الأخطاء المخصص
    // ============================================
    
    class IsolationErrorHandler {
        constructor() {
            this.errorMessages = {
                'PGRST104': '⚠️ البيانات غير موجودة أو ليست تابعة لك',
                'PGRST116': '🔒 غير مصرح: هذه البيانات ليست تابعة لحسابك',
                '42501': '⛔ تم رفض الوصول: البيانات معزولة',
                '404': '❌ البيانات غير موجودة',
                '401': '🔐 غير مصرح: يرجى تسجيل الدخول',
                'default': '⚠️ لا يمكن الوصول لهذه البيانات'
            };
        }

        // تحليل خطأ Supabase
        parseError(error) {
            if (!error) return { type: 'unknown', message: this.errorMessages.default };

            const code = error.code || error.statusCode || error.status;
            const message = error.message || error.error || '';

            // فحص رسائل خطأ RLS
            if (message.includes('row-level security') || 
                message.includes('RLS') ||
                message.includes('permission denied') ||
                message.includes('not authorized')) {
                return {
                    type: 'isolation_violation',
                    message: '🔒 هذه البيانات محمية ولا يمكن الوصول إليها',
                    original: error
                };
            }

            // فحص البيانات غير موجودة
            if (code === 'PGRST104' || 
                code === 404 || 
                message.includes('not found') ||
                message.includes('does not exist') ||
                (error.details && error.details.includes('0 rows'))) {
                return {
                    type: 'not_found',
                    message: this.errorMessages['PGRST104'],
                    original: error
                };
          }

            // فحص عدم التوثيق
            if (code === 401 || 
                code === '401' ||
                message.includes('JWT') ||
                message.includes('token') ||
                message.includes('auth')) {
                return {
                    type: 'auth_error',
                    message: this.errorMessages['401'],
                    original: error
                };
            }

            return {
                type: 'unknown',
                message: message || this.errorMessages.default,
                original: error
            };
        }

        // عرض خطأ للمستخدم
        showError(error, context = '') {
            const parsed = this.parseError(error);
            
            console.warn(`[Isolation] ${context}:`, parsed.message, parsed.original);
            
            // إنشاء إشعار بصري
            this.showNotification(parsed.message, parsed.type);
            
            return parsed;
        }

        // إنشاء إشعار
        showNotification(message, type = 'info') {
            const colors = {
                'isolation_violation': '#dc3545',
                'not_found': '#ffc107',
                'auth_error': '#fd7e14',
                'info': '#17a2b8',
                'unknown': '#6c757d'
            };

            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: ${colors[type] || colors.unknown};
                color: ${type === 'not_found' ? '#000' : '#fff'};
                padding: 15px 30px;
                border-radius: 25px;
                font-weight: bold;
                z-index: 99999;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                animation: slideDown 0.3s ease;
            `;
            notification.textContent = message;

            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.3s';
                setTimeout(() => notification.remove(), 300);
            }, 3000);
        }
    }

    // ============================================
    // 2. مدير العزل التام
    // ============================================
    
    class StrictIsolationManager {
        constructor(supabaseClient) {
            this.supabase = supabaseClient;
            this.userId = this.getCurrentUserId();
            this.errorHandler = new IsolationErrorHandler();
            
            // التحقق من المصادقة
            if (!this.userId) {
                console.error('❌ StrictIsolationManager: No user_id found!');
                this.redirectToLogin();
            }
        }

        getCurrentUserId() {
            return localStorage.getItem('slamtak-user-id') ||
                   localStorage.getItem('current_warehouse_id') ||
                   null;
        }

        redirectToLogin() {
            this.errorHandler.showNotification('🔐 يرجى تسجيل الدخول أولاً', 'auth_error');
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 2000);
        }

        // ============================================
        // 3. عمليات CRUD مع معالجة أخطاء العزل
        // ============================================

        // جلب بيانات (مع فلتر user_id صارم)
        async select(tableName, options = {}) {
            try {
                if (!this.userId) {
                    throw new Error('User not authenticated');
                }

                let query = this.supabase
                    .from(tableName)
                    .select(options.columns || '*');

                // ✅ فلتر user_id إجباري (لا نسمح بـ skip)
                query = query.eq('user_id', this.userId);

                // فلاتر إضافية
                if (options.filters) {
                    options.filters.forEach(filter => {
                        query = query.eq(filter.column, filter.value);
                    });
                }

                // البحث
                if (options.search) {
                    query = query.or(options.search);
                }

                // الترتيب
                if (options.orderBy) {
                    query = query.order(options.orderBy, { 
                        ascending: options.ascending !== false 
                    });
                }

                // التصفية
                if (options.limit) {
                    query = query.limit(options.limit);
                }

                const { data, error } = await query;

                if (error) {
                    const parsed = this.errorHandler.showError(error, `SELECT ${tableName}`);
                    
                    // إذا كان الخطأ بسبب العزل، نرجع مصفوفة فارغة
                    if (parsed.type === 'isolation_violation' || parsed.type === 'not_found') {
                        return { success: false, data: [], error: parsed.message, isolated: true };
                    }
                    
                    throw error;
                }

                return { 
                    success: true, 
                    data: data || [],
                    count: data?.length || 0
                };

            } catch (error) {
                const parsed = this.errorHandler.showError(error, `SELECT ${tableName}`);
                return { 
                    success: false, 
                    data: [], 
                    error: parsed.message,
                    isolated: parsed.type === 'isolation_violation'
                };
            }
        }

        // إضافة سجل (مع تحقق صارم من user_id)
        async insert(tableName, data) {
            try {
                if (!this.userId) {
                    throw new Error('User not authenticated');
                }

                // ✅ ربط إجباري بـ user_id الحالي
                const dataWithUser = {
                    ...data,
                    user_id: this.userId,  // ربط تلقائي
                    created_at: new Date().toISOString()
                };

                // إزالة أي محاولة لتغيير user_id
                if (data.user_id && data.user_id !== this.userId) {
                    console.warn('🚫 Attempt to spoof user_id blocked:', data.user_id);
                    dataWithUser.user_id = this.userId;  // إجبار على user_id الحالي
                }

                console.log(`🔒 Inserting into ${tableName} with strict isolation:`, {
                    user_id: this.userId,
                    table: tableName
                });

                const { data: result, error } = await this.supabase
                    .from(tableName)
                    .insert([dataWithUser])
                    .select()
                    .single();

                if (error) {
                    // فحص خاص بأخطاء RLS
                    if (error.message?.includes('cannot insert') || 
                        error.message?.includes('violates row-level security')) {
                        this.errorHandler.showError(
                            { message: '⛔ لا يمكن الإضافة: البيانات معزولة' },
                            `INSERT ${tableName}`
                        );
                        return { 
                            success: false, 
                            error: 'تم رفض الإضافة: البيانات معزولة',
                            isolated: true 
                        };
                    }
                    throw error;
                }

                return { success: true, data: result };

            } catch (error) {
                const parsed = this.errorHandler.showError(error, `INSERT ${tableName}`);
                return { success: false, error: parsed.message };
            }
        }

        // تحديث سجل (فقط للمالك)
        async update(tableName, id, updates) {
            try {
                if (!this.userId) {
                    throw new Error('User not authenticated');
                }

                // منع تغيير user_id
                if (updates.user_id && updates.user_id !== this.userId) {
                    console.error('🚫 Blocked attempt to change user_id during update');
                    delete updates.user_id;  // إزالة محاولة التلاعب
                }

                const { data, error } = await this.supabase
                    .from(tableName)
                    .update({
                        ...updates,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', id)
                    .eq('user_id', this.userId)  // ✅ فلتر الملكية
                    .select()
                    .single();

                if (error) {
                    this.errorHandler.showError(error, `UPDATE ${tableName}`);
                    return { success: false, error: 'لا يمكن التحديث: البيانات ليست تابعة لك' };
                }

                // التحقق من أنه تم التحديث
                if (!data) {
                    return { 
                        success: false, 
                        error: '⚠️ البيانات غير موجودة أو ليست تابعة لك',
                        notFound: true
                    };
                }

                return { success: true, data };

            } catch (error) {
                const parsed = this.errorHandler.showError(error, `UPDATE ${tableName}`);
                return { success: false, error: parsed.message };
            }
        }

        // حذف سجل (فقط للمالك)
        async delete(tableName, id) {
            try {
                if (!this.userId) {
                    throw new Error('User not authenticated');
                }

                const { data, error } = await this.supabase
                    .from(tableName)
                    .delete()
                    .eq('id', id)
                    .eq('user_id', this.userId)  // ✅ فلتر الملكية
                    .select();

                if (error) {
                    this.errorHandler.showError(error, `DELETE ${tableName}`);
                    return { success: false, error: 'لا يمكن الحذف: البيانات ليست تابعة لك' };
                }

                // التحقق من أنه تم الحذف
                if (!data || data.length === 0) {
                    return { 
                        success: false, 
                        error: '⚠️ البيانات غير موجودة أو ليست تابعة لك - تم رفض الحذف',
                        notFound: true,
                        notOwned: true
                    };
                }

                return { success: true, data };

            } catch (error) {
                const parsed = this.errorHandler.showError(error, `DELETE ${tableName}`);
                return { success: false, error: parsed.message };
            }
        }

        // جلب سجل واحد بالـ ID (مع التحقق من الملكية)
        async getById(tableName, id, columns = '*') {
            try {
                if (!this.userId) {
                    throw new Error('User not authenticated');
                }

                const { data, error } = await this.supabase
                    .from(tableName)
                    .select(columns)
                    .eq('id', id)
                    .eq('user_id', this.userId)  // ✅ فلتر الملكية
                    .single();

                if (error) {
                    // إذا لم يتم العثور على السجل
                    if (error.code === 'PGRST116' || error.message?.includes('0 rows')) {
                        return {
                            success: false,
                            error: '❌ البيانات غير موجودة أو ليست تابعة لك',
                            notFound: true,
                            isolated: true
                        };
                    }
                    throw error;
                }

                return { success: true, data };

            } catch (error) {
                const parsed = this.errorHandler.showError(error, `GET ${tableName} by ID`);
                return { 
                    success: false, 
                    error: parsed.message,
                    notFound: parsed.type === 'not_found',
                    isolated: parsed.type === 'isolation_violation'
                };
            }
        }
    }

    // ============================================
    // 4. تصدير للاستخدام العالمي
    // ============================================

    window.IsolationErrorHandler = IsolationErrorHandler;
    window.StrictIsolationManager = StrictIsolationManager;
    
    // دالة مساعدة للإنشاء السريع
    window.createStrictIsolation = function(supabaseClient) {
        return new StrictIsolationManager(supabaseClient);
    };

    console.log('✅ Strict Data Isolation System loaded');

})();

// ============================================
// 5. CSS للإشعارات
// ============================================

const style = document.createElement('style');
style.textContent = `
    @keyframes slideDown {
        from { transform: translate(-50%, -100%); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
    }
`;
document.head.appendChild(style);
