-- ============================================================
-- نظام إدارة الأسعار والعروض والخصومات الاحترافي
-- Pricing, Promotions & Discounts Management System
-- ============================================================

-- 1) قوائم الأسعار المتعددة
CREATE TABLE IF NOT EXISTS public.price_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  name_ar TEXT,
  code TEXT UNIQUE,
  description TEXT,
  price_type TEXT NOT NULL CHECK (price_type IN ('base', 'contract', 'customer_special', 'quantity_tier')),
  currency_code TEXT DEFAULT 'EGP',
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  valid_from DATE DEFAULT CURRENT_DATE,
  valid_until DATE,
  applies_to TEXT DEFAULT 'all' CHECK (applies_to IN ('all', 'pharmacies', 'customers', 'customer_groups')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_lists_wh ON public.price_lists(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_price_lists_active ON public.price_lists(is_active, valid_from, valid_until);

-- 2) أسعار المنتجات في قوائم الأسعار
CREATE TABLE IF NOT EXISTS public.price_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id UUID NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  min_quantity NUMERIC(14,2) DEFAULT 1 CHECK (min_quantity > 0),
  max_quantity NUMERIC(14,2),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  cost_price NUMERIC(14,2),
  min_margin_percent NUMERIC(5,2),
  valid_from DATE DEFAULT CURRENT_DATE,
  valid_until DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(price_list_id, product_id, min_quantity)
);

CREATE INDEX IF NOT EXISTS idx_price_list_items_pl ON public.price_list_items(price_list_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_product ON public.price_list_items(product_id);

-- 3) شرائح العملاء/الصيدليات
CREATE TABLE IF NOT EXISTS public.customer_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  name TEXT NOT NULL,
  name_ar TEXT,
  code TEXT UNIQUE,
  description TEXT,
  criteria JSONB DEFAULT '{}'::JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ربط العملاء بالشرائح
CREATE TABLE IF NOT EXISTS public.customer_segment_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID NOT NULL REFERENCES public.customer_segments(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(segment_id, customer_id)
);

-- ربط قوائم الأسعار بالشرائح
CREATE TABLE IF NOT EXISTS public.price_list_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id UUID NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES public.customer_segments(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(price_list_id, segment_id)
);

-- 4) الحملات والعروض الترويجية
CREATE TABLE IF NOT EXISTS public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  name_ar TEXT,
  code TEXT UNIQUE,
  description TEXT,
  promotion_type TEXT NOT NULL CHECK (promotion_type IN ('percentage_discount', 'fixed_amount_discount', 'buy_x_get_y', 'bundle', 'free_item', 'volume_discount')),
  discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed_amount')),
  discount_value NUMERIC(14,2),
  buy_quantity NUMERIC(14,2),
  get_quantity NUMERIC(14,2),
  min_order_amount NUMERIC(14,2) DEFAULT 0,
  max_discount_amount NUMERIC(14,2),
  budget_limit NUMERIC(14,2),
  usage_limit INTEGER,
  usage_count INTEGER DEFAULT 0,
  per_customer_limit INTEGER,
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  is_combinable BOOLEAN DEFAULT FALSE,
  priority INTEGER DEFAULT 100,
  applies_to TEXT DEFAULT 'all' CHECK (applies_to IN ('all', 'products', 'categories', 'brands', 'customers', 'segments')),
  requires_approval BOOLEAN DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_active ON public.promotions(is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotions_wh ON public.promotions(warehouse_id);

-- 5) منتجات/أصناف العرض
CREATE TABLE IF NOT EXISTS public.promotion_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  category_id UUID,
  is_included BOOLEAN DEFAULT TRUE,
  min_quantity NUMERIC(14,2) DEFAULT 1,
  discount_value NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_items_prom ON public.promotion_items(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_items_product ON public.promotion_items(product_id);

-- 6) تطبيقات العرض للعملاء/الشرائح
CREATE TABLE IF NOT EXISTS public.promotion_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES public.customer_segments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_promo_target CHECK (customer_id IS NOT NULL OR segment_id IS NOT NULL)
);

-- 7) سجل استخدام العروض
CREATE TABLE IF NOT EXISTS public.promotion_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE RESTRICT,
  sales_invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  discount_amount NUMERIC(14,2) NOT NULL,
  order_amount NUMERIC(14,2),
  applied_by UUID,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rules_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_promo_usage_prom ON public.promotion_usage(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_invoice ON public.promotion_usage(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_customer ON public.promotion_usage(customer_id);

-- 8) موافقات الخصومات الاستثنائية
CREATE TABLE IF NOT EXISTS public.discount_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL,
  requested_by_name TEXT,
  sales_invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  discount_type TEXT,
  discount_value NUMERIC(14,2),
  discount_amount NUMERIC(14,2),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_approvals_status ON public.discount_approvals(status);
CREATE INDEX IF NOT EXISTS idx_discount_approvals_requested ON public.discount_approvals(requested_by);

-- 9) سجل تدقيق الأسعار والعروض
CREATE TABLE IF NOT EXISTS public.pricing_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'activate', 'deactivate', 'approve', 'reject', 'apply')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('price_list', 'price_list_item', 'promotion', 'discount', 'approval')),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_audit_entity ON public.pricing_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_pricing_audit_user ON public.pricing_audit_log(user_id, created_at DESC);

-- دالة للحصول على السعر المناسب للمنتج
CREATE OR REPLACE FUNCTION public.get_product_price(
  p_product_id UUID,
  p_customer_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_quantity NUMERIC DEFAULT 1
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_price NUMERIC := 0;
  v_price_list_id UUID;
BEGIN
  -- البحث عن أفضل سعر بناءً على قائمة الأسعار النشطة
  SELECT pli.unit_price INTO v_price
  FROM public.price_list_items pli
  JOIN public.price_lists pl ON pl.id = pli.price_list_id
  WHERE pli.product_id = p_product_id
    AND pli.is_active = TRUE
    AND pl.is_active = TRUE
    AND (p_warehouse_id IS NULL OR pl.warehouse_id = p_warehouse_id OR pl.warehouse_id IS NULL)
    AND (pli.valid_from IS NULL OR pli.valid_from <= CURRENT_DATE)
    AND (pli.valid_until IS NULL OR pli.valid_until >= CURRENT_DATE)
    AND (pl.valid_from IS NULL OR pl.valid_from <= CURRENT_DATE)
    AND (pl.valid_until IS NULL OR pl.valid_until >= CURRENT_DATE)
    AND p_quantity >= pli.min_quantity
    AND (pli.max_quantity IS NULL OR p_quantity <= pli.max_quantity)
  ORDER BY pli.unit_price ASC
  LIMIT 1;
  
  IF v_price IS NULL OR v_price = 0 THEN
    -- الرجوع للسعر الأساسي من المنتج إذا وجد
    SELECT COALESCE(average_cost * 1.2, 0) INTO v_price
    FROM public.products
    WHERE id = p_product_id;
  END IF;
  
  RETURN COALESCE(v_price, 0);
END;
$$;

-- تفعيل RLS
ALTER TABLE public.price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_audit_log ENABLE ROW LEVEL SECURITY;

-- سياسات RLS
CREATE POLICY "Enable all for authenticated users" ON public.price_lists FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.price_list_items FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.customer_segments FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.customer_segment_members FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.price_list_segments FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.promotions FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.promotion_items FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON public.promotion_customers FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON public.promotion_usage FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert for authenticated users" ON public.promotion_usage FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users" ON public.discount_approvals FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON public.pricing_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert for authenticated users" ON public.pricing_audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- منح الصلاحيات
GRANT ALL ON public.price_lists TO authenticated;
GRANT ALL ON public.price_list_items TO authenticated;
GRANT ALL ON public.customer_segments TO authenticated;
GRANT ALL ON public.customer_segment_members TO authenticated;
GRANT ALL ON public.price_list_segments TO authenticated;
GRANT ALL ON public.promotions TO authenticated;
GRANT ALL ON public.promotion_items TO authenticated;
GRANT ALL ON public.promotion_customers TO authenticated;
GRANT ALL ON public.promotion_usage TO authenticated;
GRANT ALL ON public.discount_approvals TO authenticated;
GRANT ALL ON public.pricing_audit_log TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_price(UUID, UUID, UUID, NUMERIC) TO authenticated;
