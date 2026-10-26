# إعداد quantity_type في Supabase

## الخطوة 1: افتح Supabase Dashboard
روح للرابط:
```
https://supabase.com/dashboard/project/iksjhjxwphmvthryfeae
```

## الخطوة 2: افتح SQL Editor
1. من القائمة اليسار ← اختار **SQL Editor**
2. اضغط **New Query**

## الخطوة 3: الصق الكود
```sql
-- إضافة عمود quantity_type
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS quantity_type VARCHAR(20) DEFAULT 'decreasing';

-- تحديث المنتجات الموجودة
UPDATE products 
SET quantity_type = 'decreasing' 
WHERE quantity_type IS NULL;

-- التأكد من الإضافة
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'products';
```

## الخطوة 4: شغل الكود
اضغط **Run** (زر أخضر فوق)

## النتيجة
- ✅ العمود هيتضاف للجدول
- ✅ كل المنتجات القديمة هتاخد قيمة 'decreasing'
- ✅ المنتجات الجديدة هتاخد القيمة المناسبة ('fixed' أو 'decreasing')

## طريقة تانية (Table Editor)
1. روح لـ **Table Editor** ← اختار **products**
2. اضغط **Edit Table**
3. Add column:
   - Name: `quantity_type`
   - Type: `varchar`
   - Default: `decreasing`
4. **Save**

## بعد الإضافة
اعمل Refresh للصفحات:
- add-product.html
- store.html
- cart.html
