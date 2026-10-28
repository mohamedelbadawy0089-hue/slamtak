-- نظام إدارة التوصيل والتوزيع الكامل
-- Migration for delivery/distribution system

-- 1) السائقين
CREATE TABLE IF NOT EXISTS public.drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  employee_id UUID,
  full_name TEXT NOT NULL,
  phone TEXT,
  license_number TEXT,
  license_expiry DATE,
  vehicle_id UUID,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','busy','offline','suspended')),
  current_location_lat NUMERIC(10,6),
  current_location_lng NUMERIC(10,6),
  last_location_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- 2) المركبات
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  plate_number TEXT NOT NULL,
  vehicle_type TEXT,
  model TEXT,
  capacity_kg NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','in_use','maintenance','out_of_service')),
  last_maintenance_date DATE,
  next_maintenance_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(warehouse_id, plate_number)
);

-- Add foreign key from drivers to vehicles
ALTER TABLE public.drivers 
  ADD CONSTRAINT fk_drivers_vehicle 
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;

-- 3) مسارات التوزيع
CREATE TABLE IF NOT EXISTS public.delivery_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  route_number TEXT NOT NULL,
  route_name TEXT,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','planned','in_progress','completed','cancelled')),
  planned_date DATE DEFAULT CURRENT_DATE,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  total_distance_km NUMERIC(10,2),
  estimated_time_minutes INTEGER,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(warehouse_id, route_number)
);

-- 4) مهام التوصيل
CREATE TABLE IF NOT EXISTS public.delivery_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  task_number TEXT NOT NULL,
  sales_order_id UUID,
  sales_invoice_id UUID,
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  delivery_route_id UUID REFERENCES public.delivery_routes(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  pharmacy_name TEXT,
  delivery_address TEXT,
  delivery_phone TEXT,
  governorate TEXT,
  city TEXT,
  priority INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_preparation' CHECK (status IN (
    'pending_preparation','ready_for_shipping','assigned_to_driver','out_for_delivery',
    'partially_delivered','delivered','delivery_failed','returned_to_warehouse','cancelled'
  )),
  assigned_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  out_for_delivery_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  total_amount NUMERIC(14,2),
  delivery_fee NUMERIC(10,2),
  notes TEXT,
  stop_sequence INTEGER,
  estimated_arrival_time TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(warehouse_id, task_number)
);

-- 5) نقاط توقف المسار
CREATE TABLE IF NOT EXISTS public.delivery_route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_route_id UUID NOT NULL REFERENCES public.delivery_routes(id) ON DELETE CASCADE,
  delivery_task_id UUID NOT NULL REFERENCES public.delivery_tasks(id) ON DELETE CASCADE,
  stop_sequence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','arrived','completed','skipped')),
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  estimated_arrival_time TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(delivery_route_id, delivery_task_id)
);

-- 6) إثباتات التسليم
CREATE TABLE IF NOT EXISTS public.delivery_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  delivery_task_id UUID NOT NULL REFERENCES public.delivery_tasks(id) ON DELETE RESTRICT,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  recipient_name TEXT,
  recipient_title TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  items_requested JSONB,
  items_delivered JSONB,
  items_missing JSONB,
  is_partial BOOLEAN DEFAULT false,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('delivered','partial','failed','rejected')),
  failure_reason TEXT,
  signature_data TEXT, -- base64 signature
  photo_proof_urls JSONB,
  location_lat NUMERIC(10,6),
  location_lng NUMERIC(10,6),
  location_accuracy_m NUMERIC(6,2),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  audit_log JSONB DEFAULT '[]'::jsonb,
  UNIQUE(delivery_task_id)
);

-- 7) حوادث وأعطال التوصيل
CREATE TABLE IF NOT EXISTS public.delivery_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  delivery_task_id UUID REFERENCES public.delivery_tasks(id) ON DELETE SET NULL,
  delivery_route_id UUID REFERENCES public.delivery_routes(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  incident_type TEXT NOT NULL CHECK (incident_type IN ('delay','accident','breakdown','customer_unavailable','refused','other')),
  description TEXT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الفهارس
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_warehouse ON public.delivery_tasks(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_status ON public.delivery_tasks(status);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_route ON public.delivery_tasks(delivery_route_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_driver ON public.delivery_tasks(driver_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_invoice ON public.delivery_tasks(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_warehouse ON public.delivery_routes(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_driver ON public.delivery_routes(driver_id);
CREATE INDEX IF NOT EXISTS idx_drivers_warehouse ON public.drivers(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_delivery_proofs_task ON public.delivery_proofs(delivery_task_id);

-- دالة لإنشاء رقم مهمة توصيل تلقائياً
CREATE OR REPLACE FUNCTION public.generate_delivery_task_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.task_number IS NULL THEN
    NEW.task_number := 'DEL-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(nextval('delivery_task_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- تسلسل لأرقام مهام التوصيل
CREATE SEQUENCE IF NOT EXISTS delivery_task_number_seq START 1;

CREATE TRIGGER trg_generate_delivery_task_number
  BEFORE INSERT ON public.delivery_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_delivery_task_number();

-- دالة لإنشاء رقم مسار توصيل تلقائياً
CREATE OR REPLACE FUNCTION public.generate_delivery_route_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.route_number IS NULL THEN
    NEW.route_number := 'ROUTE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(nextval('delivery_route_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS delivery_route_number_seq START 1;

CREATE TRIGGER trg_generate_delivery_route_number
  BEFORE INSERT ON public.delivery_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_delivery_route_number();

-- تفعيل RLS
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_incidents ENABLE ROW LEVEL SECURITY;

-- سياسات RLS أساسية (يمكن تعديلها حسب الصلاحيات)
CREATE POLICY "Users can view their warehouse delivery data" ON public.delivery_tasks
  FOR SELECT USING (
    warehouse_id IN (
      SELECT warehouse_id FROM public.user_warehouses WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage delivery tasks in their warehouse" ON public.delivery_tasks
  FOR ALL USING (
    warehouse_id IN (
      SELECT warehouse_id FROM public.user_warehouses WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view delivery routes in their warehouse" ON public.delivery_routes
  FOR SELECT USING (
    warehouse_id IN (
      SELECT warehouse_id FROM public.user_warehouses WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage delivery routes in their warehouse" ON public.delivery_routes
  FOR ALL USING (
    warehouse_id IN (
      SELECT warehouse_id FROM public.user_warehouses WHERE user_id = auth.uid()
    )
  );

-- منح صلاحيات للخدمة
GRANT ALL ON public.drivers TO service_role;
GRANT ALL ON public.vehicles TO service_role;
GRANT ALL ON public.delivery_routes TO service_role;
GRANT ALL ON public.delivery_tasks TO service_role;
GRANT ALL ON public.delivery_route_stops TO service_role;
GRANT ALL ON public.delivery_proofs TO service_role;
GRANT ALL ON public.delivery_incidents TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
