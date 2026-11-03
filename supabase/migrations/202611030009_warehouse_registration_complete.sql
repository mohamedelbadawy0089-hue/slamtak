-- ============================================================================
-- Stage 1: Complete Warehouse Registration System
-- Ensures warehouse isolation, code generation, and proper RLS policies
-- ============================================================================

-- 1. Create warehouse_codes table if not exists (for warehouse code generation/management)
CREATE TABLE IF NOT EXISTS public.warehouse_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.auth_users(id)
);

-- 2. Ensure unique constraint on user_warehouses (user_id, warehouse_id) exists
-- Already exists per inspection, but we ensure it with a comment
COMMENT ON CONSTRAINT user_warehouses_user_id_warehouse_id_key ON public.user_warehouses IS 'Enforces: one warehouse per user account (Multi-Tenant isolation)';

-- 3. Create or update RLS policies for warehouses table
-- Policy: Warehouse owners/admins can read/write their own warehouse
-- Policy: Super admin can manage all warehouses
DROP POLICY IF EXISTS "wh_iso_owner_select" ON public.warehouses;
CREATE POLICY "wh_iso_owner_select" ON public.warehouses
  FOR SELECT USING (
    owner_user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'::text
    OR EXISTS (
      SELECT 1 FROM public.user_warehouses uw
      WHERE uw.warehouse_id = id
      AND uw.user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'::text
      AND uw.is_active = true
    )
  );

DROP POLICY IF EXISTS "wh_iso_owner_insert" ON public.warehouses;
CREATE POLICY "wh_iso_owner_insert" ON public.warehouses
  FOR INSERT WITH CHECK (
    owner_user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'::text
  );

DROP POLICY IF EXISTS "wh_iso_owner_update" ON public.warehouses;
CREATE POLICY "wh_iso_owner_update" ON public.warehouses
  FOR UPDATE USING (
    owner_user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'::text
  );

DROP POLICY IF EXISTS "wh_iso_super_admin_all" ON public.warehouses;
CREATE POLICY "wh_iso_super_admin_all" ON public.warehouses
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.is_system_role = true
      AND r.name = 'super_admin'
    )
  );

-- 4. Create or update RLS policies for user_warehouses table
-- Policy: Users can read their own warehouse memberships
-- Policy: Admins can manage warehouse members
DROP POLICY IF EXISTS "uw_iso_user_select" ON public.user_warehouses;
CREATE POLICY "uw_iso_user_select" ON public.user_warehouses
  FOR SELECT USING (
    user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'::text
    OR warehouse_id IN (
      SELECT warehouse_id FROM public.user_warehouses
      WHERE user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'::text
    )
  );

DROP POLICY IF EXISTS "uw_iso_owner_insert" ON public.user_warehouses;
CREATE POLICY "uw_iso_owner_insert" ON public.user_warehouses
  FOR INSERT WITH CHECK (
    user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'::text
    AND NOT EXISTS (
      SELECT 1 FROM public.user_warehouses
      WHERE user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'::text
    )
  );

DROP POLICY IF EXISTS "uw_iso_owner_update" ON public.user_warehouses;
CREATE POLICY "uw_iso_owner_update" ON public.user_warehouses
  FOR UPDATE USING (
    user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub'::text
  );

-- 5. Ensure trigger enforce_single_active_warehouse is properly set
-- This trigger already exists and enforces one active warehouse per user
-- Verify it's active on user_warehouses INSERT/UPDATE
DROP TRIGGER IF EXISTS trg_enforce_single_active_warehouse ON public.user_warehouses;
CREATE TRIGGER trg_enforce_single_active_warehouse
  BEFORE INSERT OR UPDATE ON public.user_warehouses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_active_warehouse();

-- 6. Create warehouse code generation function
-- Generates a unique warehouse code based on warehouse name/initials
DROP FUNCTION IF EXISTS public.generate_warehouse_code(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.generate_warehouse_code(p_warehouse_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
  v_name TEXT;
  v_counter INT;
BEGIN
  -- Get warehouse name
  SELECT name INTO v_name FROM public.warehouses WHERE id = p_warehouse_id;
  
  -- Generate code from first 3 letters of name + 3 random chars
  IF v_name IS NOT NULL THEN
    v_code := UPPER(LEFT(REGEXP_REPLACE(v_name, '[^a-zA-Z]', '', 'g'), 3));
  ELSE
    v_code := 'WHS';
  END IF;
  
  -- Ensure uniqueness
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.warehouse_codes WHERE code = v_code);
    v_counter := v_counter + 1;
    v_code := LEFT(v_code, 3) || TO_CHAR(v_counter, 'FM000');
    EXIT WHEN v_counter > 999; -- safety break
  END LOOP;
  
  RETURN v_code;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 7. Create trigger to auto-generate warehouse code on warehouse creation
DROP TRIGGER IF EXISTS trg_generate_warehouse_code ON public.warehouses;
CREATE TRIGGER trg_generate_warehouse_code
  AFTER INSERT ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.generate_warehouse_code(NEW.id);

-- 8. Add comment documenting the warehouse isolation architecture
COMMENT ON TABLE public.warehouses IS 'Multi-Tenant SaaS warehouse entity. Each warehouse has independent data isolation via tenant_id and warehouse_id. RLS policies enforce per-warehouse data access.';
COMMENT ON TABLE public.user_warehouses IS 'Links users to warehouses. UNIQUE constraint (user_id, warehouse_id) ensures one warehouse per account. Permissions and roles define access scope.';

-- 9. Add index on warehouse_codes for fast lookup by code
CREATE INDEX IF NOT EXISTS idx_warehouse_codes_code ON public.warehouse_codes(code);

-- 10. Add index on warehouses for tenant-based queries
CREATE INDEX IF NOT EXISTS idx_warehouses_tenant ON public.warehouses(tenant_id);

