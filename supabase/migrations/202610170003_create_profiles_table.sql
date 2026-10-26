-- Create profiles table for user role management
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'viewer' check (role in ('viewer', 'admin', 'super_admin', 'manager', 'warehouse_manager', 'owner')),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable row level security automatically
alter table profiles enable row level security;

-- Create RLS policies for profiles table
-- Super admins can view all profiles
create policy "Super admins can view all profiles" on profiles
  for select to authenticated using ((select role from auth.users where auth.users.id = id) = 'super-admin');

-- Users can view their own profile
create policy "Users can view own profile" on profiles
  for select to authenticated using (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile" on profiles
  for update to authenticated using (auth.uid() = id);

-- Admins and managers can view profiles of users under them (simplified)
create policy "Admins/managers can view profiles" on profiles
  for select to authenticated using ((select role from auth.users where auth.users.id = id) in ('super-admin', 'manager'));

-- Grant necessary permissions
grant all on profiles to authenticated;
grant usage on schema auth to authenticated;

-- Comment to document the RLS setup
comment on table profiles is 'RLS enabled: role-based access control for user profiles';
comment on column profiles.role is 'User role: viewer, admin, super_admin, manager, warehouse_manager, or owner';