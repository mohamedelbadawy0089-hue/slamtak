-- Execute these SQL commands to enable RLS on profiles table
-- This file is meant to be run via Supabase SQL Editor or API

-- Step 1: Enable RLS on profiles table
alter table profiles enable row level security;

-- Step 2: Create RLS policies for role-based access
create policy "Super admins can view all profiles" on profiles
  for select to authenticated using ((select role from auth.users where auth.users.id = id) = 'super-admin');

create policy "Users can view own profile" on profiles
  for select to authenticated using (auth.uid() = id);

create policy "Users can update own profile" on profiles
  for update to authenticated using (auth.uid() = id);

-- Step 3: Grant permissions
grant all on profiles to authenticated;
grant usage on schema auth to authenticated;