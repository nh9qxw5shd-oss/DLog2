-- DLog2 — stored NRSDB session for unattended ESR pulls.
--
-- nrsdb.uk's bot protection blocks the LOGIN page from datacentre IPs but
-- (per probing) not the AJAX data route. So a session cookie captured once
-- from an allowed device lets the server pull the feed itself. The cookie is
-- a live login: RLS is enabled with NO policies, so only the service-role
-- key (server-side) can read or write these tables. Never expose to anon.

CREATE TABLE IF NOT EXISTS esr_session (
  route_code    text        PRIMARY KEY DEFAULT 'EM',
  cookie        text        NOT NULL,          -- full Cookie header value as captured
  supplied_at   timestamptz NOT NULL DEFAULT now(),
  supplied_via  text,                          -- 'bookmarklet' | 'paste' | 'api'
  last_check_at timestamptz,
  last_ok_at    timestamptz,
  last_status   text,                          -- ok | expired | blocked | error
  last_error    text,
  checks        integer     NOT NULL DEFAULT 0,
  failures      integer     NOT NULL DEFAULT 0 -- consecutive
);

-- One row per keep-alive / probe / build check, to learn the session lifetime.
CREATE TABLE IF NOT EXISTS esr_session_checks (
  id          bigserial   PRIMARY KEY,
  route_code  text        NOT NULL,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  trigger     text        NOT NULL,            -- cron | probe | build | supply
  status      text        NOT NULL,            -- ok | expired | blocked | error
  http_status integer,
  esr_count   integer,
  detail      text
);
CREATE INDEX IF NOT EXISTS idx_esr_session_checks_time ON esr_session_checks (route_code, checked_at DESC);

ALTER TABLE esr_session        ENABLE ROW LEVEL SECURITY;
ALTER TABLE esr_session_checks ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service role only.

COMMENT ON TABLE esr_session IS 'NRSDB session cookie for unattended ESR pulls. Service-role only (RLS with no policies).';
COMMENT ON TABLE esr_session_checks IS 'History of NRSDB session checks (keep-alive, probe, build) with outcome, for session-lifetime analysis.';
