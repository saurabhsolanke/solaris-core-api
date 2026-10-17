-- ============================================================================
-- SOLARIS DATABASE MIGRATION: 001_initial_schema.sql
-- Solanke Operations, Leave, Attendance, Route & Intelligence System
-- ============================================================================

-- 1. Enable PostGIS and UUID Extensions
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;

-- Ensure public and extensions are on the search path
SET search_path TO public, extensions;

-- Helper to safely resolve current tenant id from Supabase JWT or session variable
CREATE OR REPLACE FUNCTION public.current_tenant_id() 
RETURNS UUID AS $$
BEGIN
  -- Check Supabase auth.jwt() claims
  BEGIN
    IF current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) <> '' THEN
      RETURN (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Fall through to next check
  END;

  -- Check session setting set by backend app connections
  IF current_setting('app.current_tenant_id', true) IS NOT NULL AND current_setting('app.current_tenant_id', true) <> '' THEN
    RETURN current_setting('app.current_tenant_id', true)::uuid;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. Tenants Table
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    subdomain TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'EMPLOYEE')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_user_email UNIQUE (tenant_id, email)
);

-- 4. Attendance Table
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    punch_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    punch_in_location geometry(Point, 4326) NOT NULL,
    punch_in_address TEXT,
    punch_out_at TIMESTAMPTZ,
    punch_out_location geometry(Point, 4326),
    punch_out_address TEXT,
    total_distance_km NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Location Pings Table (High throughput, offline resilient)
CREATE TABLE IF NOT EXISTS public.location_pings (
    id BIGSERIAL PRIMARY KEY,
    client_uuid UUID NOT NULL UNIQUE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    attendance_id UUID REFERENCES public.attendance(id) ON DELETE SET NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    geom geometry(Point, 4326) NOT NULL,
    accuracy REAL NOT NULL,
    speed REAL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial GIST Index on geometry for fast spatial querying & line assembly
CREATE INDEX IF NOT EXISTS idx_location_pings_geom 
    ON public.location_pings USING GIST (geom);

-- B-Tree Index on (user_id, recorded_at DESC) for fast telemetry tracking queries
CREATE INDEX IF NOT EXISTS idx_location_pings_user_recorded 
    ON public.location_pings (user_id, recorded_at DESC);

-- B-Tree Index on attendance_id for session distance & route reconstruction
CREATE INDEX IF NOT EXISTS idx_location_pings_attendance_recorded 
    ON public.location_pings (attendance_id, recorded_at ASC);

-- Index on tenant_id for tenant filtering
CREATE INDEX IF NOT EXISTS idx_location_pings_tenant 
    ON public.location_pings (tenant_id);

-- 6. Stopover Events Table
CREATE TABLE IF NOT EXISTS public.stopover_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    attendance_id UUID REFERENCES public.attendance(id) ON DELETE SET NULL,
    geom geometry(Point, 4326) NOT NULL,
    address TEXT,
    arrived_at TIMESTAMPTZ NOT NULL,
    departed_at TIMESTAMPTZ NOT NULL,
    dwell_minutes INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial GIST Index on stopover locations
CREATE INDEX IF NOT EXISTS idx_stopover_events_geom 
    ON public.stopover_events USING GIST (geom);

-- Index on user and arrival for timelines
CREATE INDEX IF NOT EXISTS idx_stopover_events_user_arrived 
    ON public.stopover_events (user_id, arrived_at DESC);

-- Index on attendance_id for session summaries
CREATE INDEX IF NOT EXISTS idx_stopover_events_attendance 
    ON public.stopover_events (attendance_id);

-- 7. Configure Row-Level Security (RLS) on all tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stopover_events ENABLE ROW LEVEL SECURITY;

-- Helper macro condition for RLS tenant isolation:
-- Supports both standard Supabase auth.jwt() ->> 'tenant_id' and public.current_tenant_id() fallback
-- Also permits superusers / service role to manage tables.

-- Tenants RLS
DROP POLICY IF EXISTS tenant_isolation_tenants ON public.tenants;
CREATE POLICY tenant_isolation_tenants ON public.tenants
    FOR ALL
    USING (
        id = COALESCE(
            NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
            public.current_tenant_id()
        )
        OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    );

-- Users RLS
DROP POLICY IF EXISTS tenant_isolation_users ON public.users;
CREATE POLICY tenant_isolation_users ON public.users
    FOR ALL
    USING (
        tenant_id = COALESCE(
            NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
            public.current_tenant_id()
        )
        OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    );

-- Attendance RLS
DROP POLICY IF EXISTS tenant_isolation_attendance ON public.attendance;
CREATE POLICY tenant_isolation_attendance ON public.attendance
    FOR ALL
    USING (
        tenant_id = COALESCE(
            NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
            public.current_tenant_id()
        )
        OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    );

-- Location Pings RLS
DROP POLICY IF EXISTS tenant_isolation_location_pings ON public.location_pings;
CREATE POLICY tenant_isolation_location_pings ON public.location_pings
    FOR ALL
    USING (
        tenant_id = COALESCE(
            NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
            public.current_tenant_id()
        )
        OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    );

-- Stopover Events RLS
DROP POLICY IF EXISTS tenant_isolation_stopover_events ON public.stopover_events;
CREATE POLICY tenant_isolation_stopover_events ON public.stopover_events
    FOR ALL
    USING (
        tenant_id = COALESCE(
            NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
            public.current_tenant_id()
        )
        OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    );
