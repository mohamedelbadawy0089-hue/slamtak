-- حذف خمس دوال موروثة غير قابلة للتشغيل
--
-- كل واحدة منها تستدعي جدولاً غير موجود في المخطط الحالي، فلا تستطيع العمل أصلاً
-- (تستثنى بـUndefinedTable عند أي استدعاء):
--   public.batch_process_drugs(text, jsonb)           ← drugs
--   public.delete_all_current_warehouse_drugs(text)   ← drugs
--   public.get_warehouse_stats(uuid)                  ← drugs
--   public.merge_duplicate_products(uuid)             ← drugs
--   public.search_permanent_products(text, uuid)      ← warehouse_inventory
--                                                        warehouse_custom_products
--
-- الأدلة على أنها ميتة (تحقّق يوم 20261031):
--   * لا يستدعيها أي دالة أو مشهد أو مشغّل داخل القاعدة.
--   * لا ذكر لها في public/ أو src/ أو scripts/ أو worker.js.
--   * لا يُذكر أي من الجداول الناقصة في أي ترحيل داخل supabase/migrations/.
--   * تدقيق شامل لـ336 دالة و298 مرجع جدول لم يعثر على مرجع مفقود آخر.
--
-- تُحذف بلا CASCADE لأن لا شيء يعتمد عليها.

DROP FUNCTION IF EXISTS public.batch_process_drugs(text, jsonb);
DROP FUNCTION IF EXISTS public.delete_all_current_warehouse_drugs(text);
DROP FUNCTION IF EXISTS public.get_warehouse_stats(uuid);
DROP FUNCTION IF EXISTS public.merge_duplicate_products(uuid);
DROP FUNCTION IF EXISTS public.search_permanent_products(text, uuid);
