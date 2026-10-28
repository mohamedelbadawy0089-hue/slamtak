-- ============================================================
-- Automation Engine Functions
-- ============================================================

-- دالة لفحص المنتجات التي تحتاج لإعادة الطلب
CREATE OR REPLACE FUNCTION public.check_products_needing_reorder(p_warehouse_id UUID DEFAULT NULL)
RETURNS TABLE(
  warehouse_id UUID,
  product_id UUID,
  product_name TEXT,
  current_stock INTEGER,
  reorder_point INTEGER,
  safety_stock INTEGER,
  suggested_quantity INTEGER,
  preferred_supplier_id UUID,
  supplier_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rs.warehouse_id,
    rs.product_id,
    p.name as product_name,
    COALESCE(SUM(inv.available_quantity), 0)::INTEGER as current_stock,
    rs.reorder_point,
    rs.safety_stock,
    GREATEST(
      COALESCE(rs.reorder_quantity, 50),
      COALESCE(rs.safety_stock, 0)
    )::INTEGER as suggested_quantity,
    rs.preferred_supplier_id,
    s.name as supplier_name
  FROM public.reorder_settings rs
  JOIN public.products p ON p.id = rs.product_id
  LEFT JOIN public.suppliers s ON s.id = rs.preferred_supplier_id
  LEFT JOIN public.inventory inv ON inv.warehouse_id = rs.warehouse_id AND inv.product_id = rs.product_id
  WHERE rs.is_active = TRUE 
    AND rs.auto_reorder_enabled = TRUE
    AND (p_warehouse_id IS NULL OR rs.warehouse_id = p_warehouse_id)
  GROUP BY rs.warehouse_id, rs.product_id, p.name, rs.reorder_point, rs.safety_stock, rs.reorder_quantity, rs.preferred_supplier_id, s.name
  HAVING COALESCE(SUM(inv.available_quantity), 0) <= COALESCE(rs.reorder_point, 0)
    AND NOT EXISTS (
      SELECT 1 FROM public.auto_purchase_drafts apd
      WHERE apd.warehouse_id = rs.warehouse_id 
        AND apd.product_id = rs.product_id
        AND apd.status IN ('pending_approval', 'approved')
        AND apd.created_at >= NOW() - INTERVAL '24 hours'
    );
END;
$$;

-- دالة لإنشاء مسودة طلب شراء تلقائي
CREATE OR REPLACE FUNCTION public.create_auto_purchase_draft(
  p_warehouse_id UUID,
  p_product_id UUID,
  p_suggested_quantity INTEGER,
  p_reason TEXT,
  p_rule_id UUID DEFAULT NULL,
  p_execution_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_draft_id UUID;
  v_draft_number TEXT;
  v_supplier_id UUID;
BEGIN
  -- Get supplier
  SELECT preferred_supplier_id INTO v_supplier_id
  FROM public.reorder_settings
  WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id;
  
  -- Generate draft number
  v_draft_number := 'APD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM()*10000)::TEXT, 4, '0');
  
  INSERT INTO public.auto_purchase_drafts (
    warehouse_id,
    product_id,
    supplier_id,
    suggested_quantity,
    reason,
    rule_id,
    execution_id,
    draft_number,
    status,
    calculation_details,
    expires_at
  ) VALUES (
    p_warehouse_id,
    p_product_id,
    v_supplier_id,
    p_suggested_quantity,
    p_reason,
    p_rule_id,
    p_execution_id,
    v_draft_number,
    'pending_approval',
    jsonb_build_object('created_at', NOW(), 'auto_generated', true),
    NOW() + INTERVAL '7 days'
  )
  RETURNING id INTO v_draft_id;
  
  -- Log execution
  INSERT INTO public.automation_executions (
    rule_id,
    warehouse_id,
    trigger_source,
    trigger_data,
    execution_status,
    completed_at,
    duration_ms,
    actions_executed,
    result_summary
  ) VALUES (
    p_rule_id,
    p_warehouse_id,
    'reorder_check',
    jsonb_build_object('product_id', p_product_id, 'quantity', p_suggested_quantity),
    'success',
    NOW(),
    100,
    jsonb_build_array(jsonb_build_object('action', 'create_draft', 'draft_id', v_draft_id)),
    'تم إنشاء مسودة طلب شراء تلقائي: ' || v_draft_number
  );
  
  RETURN v_draft_id;
END;
$$;

-- دالة لتحديث حالة الطلب تلقائياً
CREATE OR REPLACE FUNCTION public.auto_update_order_status(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL,
  p_rule_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_from_status TEXT;
BEGIN
  -- Get current status based on entity type
  IF p_entity_type = 'sales_order' THEN
    SELECT status INTO v_from_status FROM public.sales_orders WHERE id = p_entity_id;
    UPDATE public.sales_orders SET status = p_to_status, updated_at = NOW() WHERE id = p_entity_id;
  ELSIF p_entity_type = 'purchase_order' THEN
    SELECT status INTO v_from_status FROM public.purchase_orders WHERE id = p_entity_id;
    UPDATE public.purchase_orders SET status = p_to_status, updated_at = NOW() WHERE id = p_entity_id;
  ELSIF p_entity_type = 'sales_invoice' THEN
    SELECT status INTO v_from_status FROM public.sales_invoices WHERE id = p_entity_id;
    UPDATE public.sales_invoices SET status = p_to_status, updated_at = NOW() WHERE id = p_entity_id;
  END IF;
  
  -- Log transition
  INSERT INTO public.automation_status_transitions (
    entity_type,
    entity_id,
    from_status,
    to_status,
    transition_reason,
    triggered_by,
    rule_id,
    is_allowed,
    allowed_transition
  ) VALUES (
    p_entity_type,
    p_entity_id,
    v_from_status,
    p_to_status,
    p_reason,
    'automation',
    p_rule_id,
    TRUE,
    TRUE
  );
  
  RETURN TRUE;
END;
$$;

-- منح صلاحيات
GRANT EXECUTE ON FUNCTION public.check_products_needing_reorder(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_auto_purchase_draft(UUID, UUID, INTEGER, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_update_order_status(TEXT, UUID, TEXT, TEXT, UUID) TO authenticated;
