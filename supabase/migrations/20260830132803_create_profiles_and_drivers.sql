/*
# Create profiles and drivers tables for A C Neto Transportes

## Overview
Sets up the foundation for role-based access (admin, operator, driver) and
driver-specific data including online status and location tracking.

## 1. New Tables

### profiles
- `id` (uuid, primary key)
- `user_id` (uuid, not null, defaults to auth.uid(), links to auth.users)
- `role` (text, not null, default 'driver' — values: 'admin', 'operator', 'driver')
- `full_name` (text, nullable)
- `created_at` (timestamptz, default now())

### drivers
- `id` (uuid, primary key)
- `user_id` (uuid, not null, defaults to auth.uid(), links to auth.users)
- `full_name` (text, not null)
- `cpf` (text, nullable)
- `phone` (text, nullable)
- `email` (text, nullable)
- `vehicle_model` (text, nullable)
- `vehicle_year` (int, nullable)
- `plate` (text, nullable)
- `cnh` (text, nullable)
- `city` (text, nullable)
- `state` (text, nullable)
- `is_online` (boolean, not null, default false)
- `latitude` (numeric(9,6), nullable)
- `longitude` (numeric(9,6), nullable)
- `last_seen` (timestamptz, nullable)
- `status` (text, not null, default 'offline' — values: 'offline', 'available', 'in_negotiation', 'on_trip')
- `rating` (numeric(2,1), default 5.0)
- `total_trips` (int, default 0)
- `created_at` (timestamptz, default now())

## 2. Security (RLS)

### profiles
- Users can SELECT, INSERT, UPDATE only their own profile row.

### drivers
- SELECT: drivers see their own row; admins/operators see all rows.
- INSERT: drivers can insert only their own row.
- UPDATE: drivers can update their own row; admins/operators can update any.
- DELETE: only admins can delete.

## 3. Trigger
- Auto-creates a profile row with role='driver' when a new auth user signs up.

## 4. Indexes
- Unique index on profiles.user_id and drivers.user_id for fast lookups.
- Index on drivers.is_online for filtering available drivers.
*/

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'driver' CHECK (role IN ('admin', 'operator', 'driver')),
  full_name text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_key ON profiles(user_id);

CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  cpf text,
  phone text,
  email text,
  vehicle_model text,
  vehicle_year int,
  plate text,
  cnh text,
  city text,
  state text,
  is_online boolean NOT NULL DEFAULT false,
  latitude numeric(9,6),
  longitude numeric(9,6),
  last_seen timestamptz,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('offline', 'available', 'in_negotiation', 'on_trip')),
  rating numeric(2,1) DEFAULT 5.0,
  total_trips int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS drivers_user_id_key ON drivers(user_id);
CREATE INDEX IF NOT EXISTS drivers_is_online_idx ON drivers(is_online);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

-- profiles policies
DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- drivers policies
DROP POLICY IF EXISTS "select_drivers" ON drivers;
CREATE POLICY "select_drivers" ON drivers FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.role IN ('admin', 'operator')
    )
  );

DROP POLICY IF EXISTS "insert_own_driver" ON drivers;
CREATE POLICY "insert_own_driver" ON drivers FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_drivers" ON drivers;
CREATE POLICY "update_drivers" ON drivers FOR UPDATE
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.role IN ('admin', 'operator')
    )
  ) WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.role IN ('admin', 'operator')
    )
  );

DROP POLICY IF EXISTS "delete_drivers_admin" ON drivers;
CREATE POLICY "delete_drivers_admin" ON drivers FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, role)
  VALUES (NEW.id, 'driver')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
