-- ============================================================================
-- V7: Audit Logs in TimescaleDB Schema with Configurable Time-To-Live (TTL)
-- ============================================================================

-- 1. Create dedicated timescaledb schema
CREATE SCHEMA IF NOT EXISTS timescaledb;

-- 2. Enable TimescaleDB extension if available in the PostgreSQL instance
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb WITH SCHEMA public;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB extension not available in this PostgreSQL build; using standard table partitioning fallback: %', SQLERRM;
END $$;

-- 3. Audit Logs Table (Who, When, What Event, Which Page, Where/IP/Origin)
-- Note: Primary key includes occurred_at as required by TimescaleDB hypertable partitioning.
CREATE TABLE IF NOT EXISTS timescaledb.audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    occurred_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT now(),
    event_type VARCHAR(64) NOT NULL CHECK (event_type IN ('LOGIN', 'LOGOUT', 'PAGE_VIEW', 'CONFIG_CHANGE')),
    user_id VARCHAR(255) NOT NULL CHECK (btrim(user_id) <> ''),
    username VARCHAR(255) NOT NULL CHECK (btrim(username) <> ''),
    user_full_name VARCHAR(255),
    user_email VARCHAR(255),
    user_roles VARCHAR(255),
    page_path VARCHAR(512) NOT NULL CHECK (btrim(page_path) <> ''),
    page_title VARCHAR(255),
    ip_address VARCHAR(128) NOT NULL CHECK (btrim(ip_address) <> ''),
    client_origin VARCHAR(512),
    user_agent VARCHAR(512),
    session_id VARCHAR(255),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, occurred_at)
);

-- 4. Convert timescaledb.audit_logs into a TimescaleDB Hypertable if TimescaleDB is active
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_hypertable') THEN
        PERFORM create_hypertable(
            'timescaledb.audit_logs',
            'occurred_at',
            chunk_time_interval => INTERVAL '7 days',
            if_not_exists => TRUE
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not convert timescaledb.audit_logs to hypertable: %', SQLERRM;
END $$;

-- 5. Indexes for fast Admin filtering and full-text/attribute search
CREATE INDEX IF NOT EXISTS ix_audit_logs_occurred_at ON timescaledb.audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_event_type ON timescaledb.audit_logs (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_username ON timescaledb.audit_logs (username, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON timescaledb.audit_logs (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_page_path ON timescaledb.audit_logs (page_path, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_ip_address ON timescaledb.audit_logs (ip_address, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_session_id ON timescaledb.audit_logs (session_id, occurred_at DESC);

-- 6. Configurable Time-To-Live (TTL) / Retention Policy Table
CREATE TABLE IF NOT EXISTS timescaledb.audit_retention_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    ttl_days INT NOT NULL DEFAULT 30 CHECK (ttl_days >= 1 AND ttl_days <= 3650),
    updated_at TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_by VARCHAR(255) NOT NULL DEFAULT 'SYSTEM',
    updated_by_name VARCHAR(255) DEFAULT 'System Default',
    last_cleanup_at TIMESTAMP(6) WITH TIME ZONE,
    last_cleanup_deleted_count BIGINT NOT NULL DEFAULT 0
);

INSERT INTO timescaledb.audit_retention_config (id, ttl_days, updated_at, updated_by, updated_by_name)
VALUES (1, 30, now(), 'SYSTEM', 'System Default')
ON CONFLICT (id) DO NOTHING;

-- 7. Function to enforce TTL (syncs TimescaleDB retention policy if available + deletes expired rows)
CREATE OR REPLACE FUNCTION timescaledb.fn_apply_audit_retention(p_ttl_days INT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_ttl_days INT;
    v_deleted BIGINT := 0;
BEGIN
    SELECT COALESCE(p_ttl_days, ttl_days, 30)
      INTO v_ttl_days
      FROM timescaledb.audit_retention_config
     WHERE id = 1;

    IF v_ttl_days IS NULL OR v_ttl_days < 1 THEN
        v_ttl_days := 30;
    END IF;

    -- Sync native TimescaleDB retention policy if available
    BEGIN
        IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'remove_retention_policy')
           AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_retention_policy') THEN
            PERFORM remove_retention_policy('timescaledb.audit_logs', if_exists => TRUE);
            PERFORM add_retention_policy('timescaledb.audit_logs', make_interval(days => v_ttl_days), if_not_exists => TRUE);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Ignore if table is not a hypertable or policy call is unsupported
        NULL;
    END;

    -- Deterministically delete any records older than the configured TTL
    DELETE FROM timescaledb.audit_logs
     WHERE occurred_at < (now() - make_interval(days => v_ttl_days));
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    UPDATE timescaledb.audit_retention_config
       SET last_cleanup_at = now(),
           last_cleanup_deleted_count = v_deleted
     WHERE id = 1;

    RETURN v_deleted;
END;
$$;

-- 8. Admin View for querying audit logs with computed expiration metadata
CREATE OR REPLACE VIEW timescaledb.v_admin_audit_logs AS
SELECT
    l.id,
    l.occurred_at,
    l.event_type,
    l.user_id,
    l.username,
    l.user_full_name,
    l.user_email,
    l.user_roles,
    l.page_path,
    l.page_title,
    l.ip_address,
    l.client_origin,
    l.user_agent,
    l.session_id,
    l.details,
    c.ttl_days AS retention_ttl_days,
    (l.occurred_at + make_interval(days => c.ttl_days)) AS expires_at
FROM timescaledb.audit_logs l
CROSS JOIN timescaledb.audit_retention_config c
WHERE c.id = 1;
