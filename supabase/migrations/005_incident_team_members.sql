-- DLog2 — Team members on duty at the time of each incident
-- Each roster slot that covers an incident's start time is stored as a
-- separate row (one row per person), so queries can aggregate by individual
-- name or role without string splitting.

CREATE TABLE IF NOT EXISTS incident_team_members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid        NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  report_date date        NOT NULL,
  name        text        NOT NULL,
  role        text        NOT NULL,
  shift       text        NOT NULL CHECK (shift IN ('day', 'night')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes to support queries like "all incidents person X was on for" or
-- "breakdown by role for a date range"
CREATE INDEX IF NOT EXISTS idx_itm_incident_id  ON incident_team_members (incident_id);
CREATE INDEX IF NOT EXISTS idx_itm_report_date  ON incident_team_members (report_date);
CREATE INDEX IF NOT EXISTS idx_itm_name         ON incident_team_members (name);
CREATE INDEX IF NOT EXISTS idx_itm_role         ON incident_team_members (role);

ALTER TABLE incident_team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_incident_team_members"
  ON incident_team_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
