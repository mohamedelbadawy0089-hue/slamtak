-- ============================================================================
-- Stage 2: Warehouse RLS Policies Isolation
-- Uses ::jsonb #>> ARRAY['sub'] to extract user UUID from JWT claims
-- ============================================================================

-- 1. Warehouses table policies - owner-based access
DROP POLICY IF EXISTS "wh_iso_owner_select" ON public.warehouses;
CREATE POLICY "wh_iso_owner_select" ON public.warehouses
  FOR SELECT USING (
    owner_user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
    OR EXISTS (
      SELECT 1 FROM public.user_warehouses uw
      WHERE uw.warehouse_id = warehouses.id
      AND uw.user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
      AND uw.is_active = true
    )
  );

DROP POLICY IF EXISTS "wh_iso_owner_insert" ON public.warehouses;
CREATE POLICY "wh_iso_owner_insert" ON public.warehouses
  FOR INSERT WITH CHECK (
    owner_user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
  );

DROP POLICY IF EXISTS "wh_iso_owner_update" ON public.warehouses;
CREATE POLICY "wh_iso_owner_update" ON public.warehouses
  FOR UPDATE USING (
    owner_user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
  );

-- Super admin bypass (check roles table)
DROP POLICY IF EXISTS "wh_iso_super_admin_all" ON public.warehouses;
CREATE POLICY "wh_iso_super_admin_all" ON public.warehouses
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.is_system_role = true
      AND r.name = 'super_admin'
    )
  );

-- 2. user_warehouses table policies - user's own memberships
DROP POLICY IF EXISTS "uw_iso_user_select" ON public.user_warehouses;
CREATE POLICY "uw_iso_user_select" ON public.user_warehouses
  FOR SELECT USING (
    user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
    OR warehouse_id IN (
      SELECT warehouse_id FROM public.user_warehouses
      WHERE user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
    )
  );

DROP POLICY IF EXISTS "uw_iso_owner_insert" ON public.user_warehouses;
CREATE POLICY "uw_iso_owner_insert" ON public.user_warehouses
  FOR INSERT WITH CHECK (
    user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
    AND NOT EXISTS (
      SELECT 1 FROM public.user_warehouses
      WHERE user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
    )
  );

DROP POLICY IF EXISTS "uw_iso_owner_update" ON public.user_warehouses;
CREATE POLICY "uw_iso_owner_update" ON public.user_warehouses
  FOR UPDATE USING (
    user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
  );

-- 3. Add policy for warehouse_codes table - owner or super_admin access
DROP POLICY IF EXISTS "wc_iso_owner_select" ON public.warehouse_codes;
CREATE POLICY "wc_iso_owner_select" ON public.warehouse_codes
  FOR SELECT USING (
    warehouse_id IN (
      SELECT warehouse_id FROM public.user_warehouses
      WHERE user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
    )
    OR EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.is_system_role = true
      AND r.name = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "wc_iso_owner_insert" ON public.warehouse_codes;
CREATE POLICY "wc_iso_owner_insert" ON public.warehouse_codes
  FOR INSERT WITH CHECK (
    warehouse_id IN (
      SELECT warehouse_id FROM public.user_warehouses
      WHERE user_id = (current_setting('request.jwt.claims', true)::jsonb #>> ARRAY['sub'])::uuid
    )
    OR EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.is_system_role = true
      AND r.name = 'super_admin'
    )
  );

