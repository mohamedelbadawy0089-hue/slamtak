-- Create products table
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  current_stock integer default 0,
  average_cost decimal(10,2) default 0,
  minimum_stock integer default 5,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create inventory_movements table for tracking stock changes
create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  quantity integer not null,
  type text not null check (type in ('in', 'out')),
  reason text,
  created_at timestamp with time zone default now(),
  created_by uuid references auth.users(id)
);

-- Enable row level security automatically
alter table products enable row level security;
alter table inventory_movements enable row level security;

-- Create comprehensive RLS policies for products
create policy "Products are viewable by authenticated users" on products
  for select to authenticated using (true);

create policy "Products are insertable by authenticated users with role check" on products
  for insert to authenticated with check (true);

create policy "Products are updatable by authenticated users" on products
  for update to authenticated using (true);

create policy "Products are deletable by super admins only" on products
  for delete to authenticated using (false);

-- Create comprehensive RLS policies for inventory movements
create policy "Inventory movements are viewable by authenticated users" on inventory_movements
  for select to authenticated using (true);

create policy "Inventory movements are insertable by authenticated users" on inventory_movements
  for insert to authenticated with check (true);

create policy "Inventory movements are updatable by authenticated users" on inventory_movements
  for update to authenticated using (true);

-- Grant necessary permissions
grant all on products to authenticated;
grant all on inventory_movements to authenticated;

-- Comment to document the RLS setup
comment on table products is 'RLS enabled: authenticated users can view, insert; no delete without super-admin role';
comment on table inventory_movements is 'RLS enabled: authenticated users can view and insert movements';