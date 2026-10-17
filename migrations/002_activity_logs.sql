-- ============================================================================
-- SOLARIS DATABASE MIGRATION: 002_activity_logs.sql
-- Tracks every authenticated API activity per user/tenant.
-- Records login events, IP addresses, device info, and activity types.
-- ============================================================================

-- 1. User Activity Logs Table
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
    id           BIGSERIAL    PRIMARY KEY,
    tenant_id    UUID         NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id      UUID         NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
    event_type   TEXT         NOT NULL, -- 'LOGIN', 'PUNCH_IN', 'PUNCH_OUT', 'BATCH_INGEST', 'ROUTE_VIEW'
    ip_address   INET,
    user_agent   TEXT,
    endpoint     TEXT,                  -- The API route accessed e.g. '/api/v1/attendance/punch-in'
    method       TEXT,                  -- HTTP verb: GET, POST, etc.
    status_code  SMALLINT,              -- HTTP response status code
    metadata     JSONB DEFAULT '{}',    -- Flexible extra context (e.g. attendance_id, ping count)
    logged_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2. Indexes for fast tenant + user queries
CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant_user
    ON public.user_activity_logs (tenant_id, user_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_event_type
    ON public.user_activity_logs (tenant_id, event_type, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_logged_at
    ON public.user_activity_logs (logged_at DESC);

-- 3. Enable Row-Level Security
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_activity_logs ON public.user_activity_logs;
CREATE POLICY tenant_isolation_activity_logs ON public.user_activity_logs
    FOR ALL
    USING (
        tenant_id = COALESCE(
            NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid,
            public.current_tenant_id()
        )
        OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    );

-- 4. Helper view: login count per user per day (useful for admin dashboards)
CREATE OR REPLACE VIEW public.v_user_login_summary AS
SELECT
    tenant_id,
    user_id,
    DATE(logged_at) AS activity_date,
    COUNT(*) FILTER (WHERE event_type = 'LOGIN')        AS login_count,
    COUNT(*) FILTER (WHERE event_type = 'PUNCH_IN')     AS punch_in_count,
    COUNT(*) FILTER (WHERE event_type = 'PUNCH_OUT')    AS punch_out_count,
    COUNT(*) FILTER (WHERE event_type = 'BATCH_INGEST') AS batch_ingest_count,
    MIN(logged_at) FILTER (WHERE event_type = 'LOGIN')  AS first_login_at,
    MAX(logged_at) FILTER (WHERE event_type = 'LOGIN')  AS last_login_at
FROM public.user_activity_logs
GROUP BY tenant_id, user_id, DATE(logged_at);
